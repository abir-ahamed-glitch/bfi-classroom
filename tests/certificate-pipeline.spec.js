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

  const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(user.id);

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

test.describe('Certificate Designer & Issuance Pipeline Suite', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => {
      console.error('[Browser PageError]:', err.message);
    });
  });

  test('1. Certificate Designer: Interactive Canvas, Course Switching & Style Controls', async ({ page }) => {
    await injectAuth(page, 'admin');
    await page.goto('/bfi-classroom/admin/certificate-designer', { waitUntil: 'networkidle' });

    // Verify Title & Header
    await expect(page.locator('h1.text-gradient')).toContainText('Certificate Designer');

    // Verify Live Canvas exists
    const canvas = page.locator('#cert-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Verify Course Selector
    const courseSelect = page.locator('select.input-glass').first();
    await expect(courseSelect).toBeVisible();

    // Switch Course to "Film Appreciation Course"
    await courseSelect.selectOption('Film Appreciation Course');
    await page.waitForTimeout(600);

    // Verify Live Preview shows selected course name
    await expect(page.locator('.glass-panel').filter({ hasText: 'Live Preview' })).toContainText('Film Appreciation Course');

    // Switch back to "Online Filmmaking Course"
    await courseSelect.selectOption('Online Filmmaking Course');
    await page.waitForTimeout(600);
    await expect(page.locator('.glass-panel').filter({ hasText: 'Live Preview' })).toContainText('Online Filmmaking Course');

    // Verify Canvas Field items
    const fieldItems = page.locator('.glass-panel').filter({ hasText: 'Canvas Fields' }).locator('.input-glass, span, div');
    await expect(fieldItems.first()).toBeVisible();

    // Click Student ID canvas field to activate styling controls
    const studentIdField = page.locator('span:has-text("Student ID")').first();
    if (await studentIdField.isVisible()) {
      await studentIdField.click();
      await page.waitForTimeout(300);
      // Verify style controls appear
      await expect(page.locator('span:has-text("Text Color"), label:has-text("Text Color")').first()).toBeVisible();
    }

    // Verify Save Template button works
    const saveBtn = page.locator('button:has-text("Save Template")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify success banner/message
    const successMsg = page.locator('div:has-text("Saved for")').first();
    await expect(successMsg).toBeVisible({ timeout: 8000 });
    await expect(successMsg).toContainText('Online Filmmaking Course');
  });

  test('2. Certificate Template API Endpoints (Admin Verification)', async ({ page }) => {
    const { token } = getTokenAndUser('admin');
    await injectAuth(page, 'admin');

    // Verify GET /api/certification/template for Online Filmmaking Course
    const getRes = await page.request.get('/api/certification/template?courseName=Online%20Filmmaking%20Course', {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(getRes.status()).toBe(200);
    const templateData = await getRes.json();
    expect(templateData.course_name).toBe('Online Filmmaking Course');
    expect(templateData.layout_json).toBeTruthy();

    // Verify POST /api/certification/template keeps data intact
    const postRes = await page.request.post('/api/certification/template', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: {
        course_name: 'Online Filmmaking Course',
        layout_json: templateData.layout_json,
        background_url: templateData.background_url || ''
      }
    });
    expect(postRes.status()).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.message).toContain('Certificate template saved successfully');
  });

  test('3. Student Certificate Dashboard & PDF Generation Flow', async ({ page }) => {
    // Log in as student mollaomarsany (has completed Online Filmmaking Course with all fees settled)
    await injectAuth(page, 'student', 'mollaomarsany');
    await page.goto('/bfi-classroom/certificates', { waitUntil: 'networkidle' });

    // Verify My Certificates heading
    await expect(page.locator('h1.text-gradient')).toContainText('My Certificates');

    // Verify Verified Completion card is rendered
    const certCard = page.locator('.glass-panel').filter({ hasText: 'Verified Completion' });
    await expect(certCard).toBeVisible({ timeout: 10000 });
    await expect(certCard).toContainText('Online Filmmaking Course');

    // Verify Student Details
    await expect(certCard).toContainText('Molla Omar Sany');
    await expect(certCard).toContainText('BFI21782025');
    await expect(certCard).toContainText('78');

    // Verify Official PDF Certificate button
    const pdfBtn = certCard.locator('button:has-text("Official PDF Certificate")');
    await expect(pdfBtn).toBeVisible();

    // Trigger PDF generation
    await pdfBtn.click();

    // Verify button briefly reflects generating state or resets back
    await page.waitForTimeout(2000);
    await expect(pdfBtn).toBeVisible();

    // Verify that the download event is logged in DB
    const latestDownload = db.prepare(
      'SELECT course_name FROM certificate_downloads WHERE user_id = 555 ORDER BY id DESC LIMIT 1'
    ).get();
    expect(latestDownload?.course_name).toBe('Online Filmmaking Course');
  });

  test('4. Empty State Enforcement for Incomplete / Non-Graduated Students', async ({ page }) => {
    // Log in as student eathsharajsharon (step4_completed = 0)
    await injectAuth(page, 'student', 'eathsharajsharon');
    await page.goto('/bfi-classroom/certificates', { waitUntil: 'networkidle' });

    // Verify Empty State is cleanly displayed
    await expect(page.locator('h1.text-gradient')).toContainText('My Certificates');
    const emptyState = page.locator('.glass-panel:has-text("No Certificates Yet")');
    await expect(emptyState).toBeVisible({ timeout: 10000 });
    await expect(emptyState).toContainText('Complete your enrolled courses to unlock your official BFI certificates.');

    // Ensure no downloadable certificate buttons exist for this student
    const pdfButtons = page.locator('button:has-text("Official PDF Certificate")');
    await expect(pdfButtons).toHaveCount(0);
  });
});
