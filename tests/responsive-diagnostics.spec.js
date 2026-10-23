import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

dotenv.config();

import { assertIsolatedTestDatabase, getTestDbPath, initIsolatedTestDatabase } from './test-db-isolation.js';

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let adminUser;

test.beforeAll(async () => {
  db = await initIsolatedTestDatabase(DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: `${adminUser.first_name} ${adminUser.last_name}` },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
});

test.afterAll(() => {
  if (db) db.close();
});

const VIEWPORTS = [
  { name: '320px-mobile-narrow', width: 320, height: 568 },
  { name: '375px-mobile-standard', width: 375, height: 812 },
  { name: '390px-mobile-modern', width: 390, height: 844 },
  { name: '844x390-mobile-landscape', width: 844, height: 390 },
  { name: '768px-tablet-portrait', width: 768, height: 1024 },
  { name: '1024px-tablet-landscape', width: 1024, height: 768 },
  { name: '1280px-laptop', width: 1280, height: 800 },
  { name: '1680px-desktop-wide', width: 1680, height: 1050 }
];

async function checkPageOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const winWidth = window.innerWidth;
    const bodyWidth = document.body.scrollWidth;
    const overflowingElements = [];

    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.right > winWidth + 2 && el.offsetWidth > 0 && el.offsetHeight > 0) {
        overflowingElements.push({
          tag: el.tagName,
          className: el.className,
          id: el.id,
          right: rect.right,
          winWidth
        });
        if (overflowingElements.length >= 5) break;
      }
    }

    return {
      hasOverflow: docWidth > winWidth + 1 || bodyWidth > winWidth + 1,
      docWidth,
      winWidth,
      bodyWidth,
      overflowingElements
    };
  });

  return overflow;
}

test('Responsive Diagnostics: Catalog, Builder, and Review across viewports', async ({ page }) => {
  const userPayload = {
    id: adminUser.id,
    username: adminUser.username,
    email: adminUser.email,
    role: 'admin',
    firstName: adminUser.first_name,
    lastName: adminUser.last_name
  };

  await page.addInitScript(({ t, u }) => {
    localStorage.setItem('token', t);
    localStorage.setItem('auth_user_cache', JSON.stringify(u));
  }, { t: adminToken, u: userPayload });

  const auditReport = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('http://localhost:5174/bfi-classroom/admin/course-maker', { waitUntil: 'networkidle' });

    // 1. Check Catalog View
    const catalogOverflow = await checkPageOverflow(page, `${vp.name} - Catalog`);
    auditReport.push({ viewport: vp.name, state: 'catalog', ...catalogOverflow });

    // 2. Open Builder Form
    const newBtn = page.locator('button', { hasText: 'Create New Course' }).or(page.locator('button', { hasText: 'Start Your First Course' })).first();
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(500);

      // Check Builder View with 3 phases
      const phase3Btn = page.locator('button', { hasText: '3' }).first();
      if (await phase3Btn.isVisible()) {
        await phase3Btn.click();
        await page.waitForTimeout(300);
      }

      const builderOverflow = await checkPageOverflow(page, `${vp.name} - Builder`);
      auditReport.push({ viewport: vp.name, state: 'builder', ...builderOverflow });

      // 3. Open Review Mode
      const reviewBtn = page.locator('button', { hasText: 'Review & Publish' }).first();
      if (await reviewBtn.isVisible()) {
        await reviewBtn.click();
        await page.waitForTimeout(500);

        const reviewOverflow = await checkPageOverflow(page, `${vp.name} - Review`);
        auditReport.push({ viewport: vp.name, state: 'review', ...reviewOverflow });
      }
    }
  }

  console.log('=== RESPONSIVE AUDIT FINDINGS ===');
  console.log(JSON.stringify(auditReport.filter(r => r.hasOverflow), null, 2));
  expect(auditReport.filter(r => r.hasOverflow)).toEqual([]);
});
