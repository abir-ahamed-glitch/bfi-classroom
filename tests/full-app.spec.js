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

async function setupDiagnostics(page, routeLabel, findings) {
  const currentFindings = {
    route: routeLabel,
    pageErrors: [],
    consoleErrors: [],
    apiErrors: [],
    errorBoundaryTriggered: false,
  };
  findings.push(currentFindings);

  const onPageError = (err) => {
    currentFindings.pageErrors.push(err.message || String(err));
  };
  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      currentFindings.consoleErrors.push(msg.text());
    }
  };
  const onResponse = async (res) => {
    const url = res.url();
    const status = res.status();
    if (status >= 400) {
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {
        // ignore
      }
      currentFindings.apiErrors.push({
        status,
        method: res.request().method(),
        url: url.replace('http://localhost:5174', ''),
        body: bodyText.slice(0, 300),
      });
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);

  return () => {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('response', onResponse);
  };
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

async function checkErrorBoundary(page, currentFindings) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (
    bodyText.includes('Something went wrong') ||
    bodyText.includes('Unexpected Application Error') ||
    bodyText.includes('Component Stack')
  ) {
    currentFindings.errorBoundaryTriggered = true;
    currentFindings.pageErrors.push(`ErrorBoundary rendered: ${bodyText.slice(0, 300)}`);
  }
}

test.describe('Full Application E2E Audit via Microsoft Playwright', () => {
  test('1. Public & Authentication Pages Audit', async ({ page }) => {
    const findings = [];

    const publicRoutes = [
      '/bfi-classroom/login',
      '/bfi-classroom/forgot-password',
      '/bfi-classroom/reset-password/1/invalid-test-token',
      '/bfi-classroom/admin/login',
      '/bfi-classroom/admin/forgot-password',
      '/bfi-classroom/admin/reset-password/1/invalid-test-token',
    ];

    for (const route of publicRoutes) {
      const cleanup = await setupDiagnostics(page, `Public: ${route}`, findings);
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      await checkErrorBoundary(page, findings[findings.length - 1]);
      cleanup();
    }

    const problemRoutes = findings.filter(
      (f) => f.pageErrors.length || f.consoleErrors.length || f.apiErrors.length || f.errorBoundaryTriggered
    );
    console.log('PUBLIC ROUTES AUDIT FINDINGS:', JSON.stringify(problemRoutes, null, 2));
    expect(problemRoutes).toEqual([]);
  });

  test('2. Admin Role - All Routes, Views & Interactive Features', async ({ page }) => {
    const findings = [];
    await injectAuth(page, 'admin', 'admin@abir');

    const adminRoutes = [
      { path: '/bfi-classroom/', label: 'Admin Dashboard' },
      { path: '/bfi-classroom/notices', label: 'NoticeBoard' },
      { path: '/bfi-classroom/inbox', label: 'Inbox' },
      { path: '/bfi-classroom/classroom', label: 'Classroom' },
      { path: '/bfi-classroom/profile', label: 'Admin Own Profile' },
      { path: '/bfi-classroom/profile/8', label: 'Public Profile (Student #8)' },
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
      { path: '/bfi-classroom/admin/additional-options', label: 'Admin AdditionalOptions (Default)' },
      { path: '/bfi-classroom/admin/additional-options?view=course-settings', label: 'Admin AdditionalOptions (Course Settings)' },
      { path: '/bfi-classroom/admin/additional-options?view=batch-fees', label: 'Admin AdditionalOptions (Batch Fees)' },
      { path: '/bfi-classroom/admin/additional-options?view=fee-tracker', label: 'Admin AdditionalOptions (Fee Tracker)' },
      { path: '/bfi-classroom/admin/additional-options?view=trash', label: 'Admin AdditionalOptions (Trash Manager)' },
    ];

    for (const r of adminRoutes) {
      const cleanup = await setupDiagnostics(page, r.label, findings);
      await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      await checkErrorBoundary(page, findings[findings.length - 1]);
      cleanup();
    }

    const problemRoutes = findings.filter(
      (f) => f.pageErrors.length || f.consoleErrors.length || f.apiErrors.length || f.errorBoundaryTriggered
    );
    console.log('ADMIN ROUTES AUDIT FINDINGS:', JSON.stringify(problemRoutes, null, 2));
    expect(problemRoutes).toEqual([]);
  });

  test('3. Student Role - All Routes & Portal Features', async ({ page }) => {
    const findings = [];
    await injectAuth(page, 'student', 'eathsharajsharon');

    const studentRoutes = [
      { path: '/bfi-classroom/', label: 'Student Dashboard' },
      { path: '/bfi-classroom/student-portal', label: 'Student Portal' },
      { path: '/bfi-classroom/certificates', label: 'Student Certificates' },
      { path: '/bfi-classroom/courses', label: 'Student Course Materials' },
      { path: '/bfi-classroom/classroom', label: 'Student Classroom' },
      { path: '/bfi-classroom/notices', label: 'Student NoticeBoard' },
      { path: '/bfi-classroom/inbox', label: 'Student Inbox' },
      { path: '/bfi-classroom/profile', label: 'Student Own Profile' },
      { path: '/bfi-classroom/portfolio', label: 'Student Portfolio' },
      { path: '/bfi-classroom/experience', label: 'Student Experience' },
      { path: '/bfi-classroom/community', label: 'Student Community' },
      { path: '/bfi-classroom/bfiaa', label: 'Student BFIAA' },
      { path: '/bfi-classroom/directory', label: 'Student Directory' },
      { path: '/bfi-classroom/registry', label: 'Student Registry' },
      { path: '/bfi-classroom/instructors', label: 'Student InstructorDirectory' },
      { path: '/bfi-classroom/settings', label: 'Student Settings' },
    ];

    for (const r of studentRoutes) {
      const cleanup = await setupDiagnostics(page, r.label, findings);
      await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1600);
      await checkErrorBoundary(page, findings[findings.length - 1]);
      cleanup();
    }

    const problemRoutes = findings.filter(
      (f) => f.pageErrors.length || f.consoleErrors.length || f.apiErrors.length || f.errorBoundaryTriggered
    );
    console.log('STUDENT ROUTES AUDIT FINDINGS:', JSON.stringify(problemRoutes, null, 2));
    expect(problemRoutes).toEqual([]);
  });

  test('4. Instructor Role - All Routes & Features', async ({ page }) => {
    const findings = [];
    await injectAuth(page, 'instructor', 'syedshababaliarzoo');

    const instructorRoutes = [
      { path: '/bfi-classroom/', label: 'Instructor Dashboard' },
      { path: '/bfi-classroom/courses', label: 'Instructor Course Materials' },
      { path: '/bfi-classroom/classroom', label: 'Instructor Classroom' },
      { path: '/bfi-classroom/admin/announcements', label: 'Instructor BroadcastManager' },
      { path: '/bfi-classroom/notices', label: 'Instructor NoticeBoard' },
      { path: '/bfi-classroom/inbox', label: 'Instructor Inbox' },
      { path: '/bfi-classroom/profile', label: 'Instructor Own Profile' },
      { path: '/bfi-classroom/portfolio', label: 'Instructor Portfolio' },
      { path: '/bfi-classroom/experience', label: 'Instructor Experience' },
      { path: '/bfi-classroom/community', label: 'Instructor Community' },
      { path: '/bfi-classroom/bfiaa', label: 'Instructor BFIAA' },
      { path: '/bfi-classroom/directory', label: 'Instructor Directory' },
      { path: '/bfi-classroom/registry', label: 'Instructor Registry' },
      { path: '/bfi-classroom/instructors', label: 'Instructor InstructorDirectory' },
      { path: '/bfi-classroom/settings', label: 'Instructor Settings' },
    ];

    for (const r of instructorRoutes) {
      const cleanup = await setupDiagnostics(page, r.label, findings);
      await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1600);
      await checkErrorBoundary(page, findings[findings.length - 1]);
      cleanup();
    }

    const problemRoutes = findings.filter(
      (f) => f.pageErrors.length || f.consoleErrors.length || f.apiErrors.length || f.errorBoundaryTriggered
    );
    console.log('INSTRUCTOR ROUTES AUDIT FINDINGS:', JSON.stringify(problemRoutes, null, 2));
    expect(problemRoutes).toEqual([]);
  });

  test('5. Deep Interactive Flows, Tabs, Drawers & Modals Audit', async ({ page }) => {
    const findings = [];
    await injectAuth(page, 'admin', 'admin@abir');

    // 5a. Trash Manager All 10 Tabs
    const trashTabs = ['dashboard', 'students', 'leads', 'teachers', 'batches', 'announcements', 'broadcasts', 'posts', 'materials', 'projects'];
    for (const tab of trashTabs) {
      const cleanup = await setupDiagnostics(page, `TrashManager Tab: ${tab}`, findings);
      await page.goto(`/bfi-classroom/admin/additional-options?view=trash&tab=${tab}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      await checkErrorBoundary(page, findings[findings.length - 1]);
      cleanup();
    }

    // 5b. Analytics Stat Card Drawers
    const cleanupAnalytics = await setupDiagnostics(page, 'Analytics Interactive Drawers', findings);
    await page.goto('/bfi-classroom/admin/analytics', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const statCards = page.locator('.stat-card.clickable');
    const cardCount = Math.min(await statCards.count(), 4);
    for (let i = 0; i < cardCount; i++) {
      await statCards.nth(i).click({ force: true });
      await page.waitForTimeout(800);
      const closeBtn = page.locator('.analytics-drawer-close').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.evaluate((el) => el.click()).catch(() => closeBtn.click({ force: true }));
        await page.waitForTimeout(400);
      }
    }
    await checkErrorBoundary(page, findings[findings.length - 1]);
    cleanupAnalytics();

    // 5c. Notification Panel & Theme Toggle on Dashboard
    const cleanupHeader = await setupDiagnostics(page, 'Dashboard Notification Panel & Theme Toggle', findings);
    await page.goto('/bfi-classroom/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const bellBtn = page.locator('.desktop-only-header button').first();
    if (await bellBtn.isVisible()) {
      await bellBtn.click();
      await page.waitForTimeout(600);
    }
    await checkErrorBoundary(page, findings[findings.length - 1]);
    cleanupHeader();

    const problemRoutes = findings.filter(
      (f) => f.pageErrors.length || f.consoleErrors.length || f.apiErrors.length || f.errorBoundaryTriggered
    );
    console.log('DEEP INTERACTIVE FLOWS FINDINGS:', JSON.stringify(problemRoutes, null, 2));
    expect(problemRoutes).toEqual([]);
  });
});
