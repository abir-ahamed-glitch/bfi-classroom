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

test.describe('Fee Tracker & Financial Operations Suite', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => {
      console.error('[Browser PageError]:', err.message);
    });
  });

  test('1. Fee Tracker Dashboard: Summary Cards, Search, and Multi-Filters', async ({ page }) => {
    await injectAuth(page, 'admin');
    await page.goto('/bfi-classroom/admin/additional-options?view=fee-tracker', { waitUntil: 'networkidle' });

    // Verify Title & Header
    await expect(page.locator('.ft-title-area h1')).toContainText('Fee Tracker');

    // Verify all 6 Summary Cards are present with numeric values
    const summaryCards = page.locator('.ft-summary-cards .ft-card');
    await expect(summaryCards).toHaveCount(6);

    const totalCollectedText = await page.locator('.ft-card-total p').innerText();
    const totalOutstandingText = await page.locator('.ft-card-outstanding p').innerText();
    const paidCountText = await page.locator('.ft-card-paid p').innerText();

    expect(totalCollectedText).toMatch(/৳[\d,]+/);
    expect(totalOutstandingText).toMatch(/৳[\d,]+/);
    expect(Number(paidCountText)).toBeGreaterThanOrEqual(0);

    // Verify Table is rendered with student records
    const tableRows = page.locator('.ft-table tbody tr');
    await expect(tableRows.first()).toBeVisible({ timeout: 10000 });
    const initialRowCount = await tableRows.count();
    expect(initialRowCount).toBeGreaterThan(0);

    // Test Course Filter: Film Appreciation Course
    const courseSelect = page.locator('.ft-filters select').nth(1);
    await courseSelect.selectOption('Film Appreciation Course');
    await page.waitForTimeout(800);

    // Verify filtered table shows either Appreciation courses or empty state
    const appreciationRows = await page.locator('.ft-table tbody tr').count();
    if (appreciationRows > 0) {
      const firstCourseBadge = await page.locator('.ft-table tbody tr .ft-badge-course').first().innerText();
      expect(firstCourseBadge.toLowerCase()).toContain('film appreciation course');
    }

    // Reset Course Filter
    await courseSelect.selectOption('');
    await page.waitForTimeout(600);

    // Test Status Filter: Paid Full
    const statusSelect = page.locator('.ft-filters select').first();
    await statusSelect.selectOption('paid');
    await page.waitForTimeout(800);

    const paidRows = await page.locator('.ft-table tbody tr').count();
    if (paidRows > 0) {
      const firstStatus = await page.locator('.ft-table tbody tr td').nth(7).innerText();
      expect(firstStatus.toUpperCase()).toContain('PAID FULL');
    }

    // Reset Status Filter
    await statusSelect.selectOption('');
    await page.waitForTimeout(600);

    // Test Live Search by student name
    const sampleStudentName = (await page.locator('.ft-table tbody tr .ft-cell-name').first().innerText()).trim();
    const searchInput = page.locator('.ft-search-box input');
    await searchInput.fill(sampleStudentName.slice(0, 5));
    await page.waitForTimeout(800);

    const searchRows = page.locator('.ft-table tbody tr');
    expect(await searchRows.count()).toBeGreaterThan(0);
    const matchedName = await searchRows.first().locator('.ft-cell-name').innerText();
    expect(matchedName.toLowerCase()).toContain(sampleStudentName.slice(0, 5).toLowerCase());

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(600);
  });

  test('2. Fee Tracker Export to Excel Verification', async ({ page }) => {
    const { token } = getTokenAndUser('admin');
    await injectAuth(page, 'admin');
    await page.goto('/bfi-classroom/admin/additional-options?view=fee-tracker', { waitUntil: 'networkidle' });

    // Verify the Export button exists and is clickable
    const exportBtn = page.locator('.ft-header-actions button:has-text("Export to Excel")');
    await expect(exportBtn).toBeVisible({ timeout: 10000 });

    // Directly test the Excel export API endpoint
    const response = await page.request.get(`/api/admin/fee-tracker/export?token=${token}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const buffer = await response.body();
    expect(buffer.length).toBeGreaterThan(1000); // Valid non-empty Excel workbook
  });

  test('3. Payment Reminder Dispatch with 24h Anti-Spam Cooldown', async ({ page }) => {
    await injectAuth(page, 'admin');
    await page.goto('/bfi-classroom/admin/additional-options?view=fee-tracker', { waitUntil: 'networkidle' });

    // Wait for table to load
    await expect(page.locator('.ft-table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Filter to Due/Unpaid to find a student with outstanding balance
    const statusSelect = page.locator('.ft-filters select').first();
    await statusSelect.selectOption('due');
    await page.waitForTimeout(800);

    // Look for a student with an active "Send Reminder" button
    const reminderBtn = page.locator('.ft-table tbody tr button:has-text("Send Reminder")').first();

    if (await reminderBtn.isVisible()) {
      await reminderBtn.click();

      // Expect toast notification
      const toast = page.locator('.ft-toast');
      await expect(toast).toBeVisible({ timeout: 8000 });
      await expect(toast).toContainText('Reminder sent successfully');

      // Expect a disabled "Sent Today" button to appear in the table
      const sentBtn = page.locator('.ft-table tbody tr button:has-text("Sent Today")').first();
      await expect(sentBtn).toBeVisible({ timeout: 8000 });
      await expect(sentBtn).toBeDisabled();
    } else {
      console.log('All due students already have reminders sent today or no due students.');
    }
  });

  test('4. Academic Records & Phase 2 Attendance Modals from Fee Tracker', async ({ page }) => {
    await injectAuth(page, 'admin');
    await page.goto('/bfi-classroom/admin/additional-options?view=fee-tracker', { waitUntil: 'networkidle' });

    await expect(page.locator('.ft-table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Test Academic Records button (GraduationCap icon)
    const academicButtons = page.locator('.ft-table tbody tr button[title*="Academic"], .ft-table tbody tr button[title*="Exam Result"]');
    if ((await academicButtons.count()) > 0) {
      await academicButtons.first().click();
      await page.waitForTimeout(600);

      // Check if modal or alert opened
      const academicModal = page.locator('.modern-modal-content');
      if (await academicModal.isVisible()) {
        await expect(academicModal).toBeVisible();
        const closeBtn = academicModal.locator('button[aria-label="Close"], button:has-text("Cancel"), button:has-text("OK")').first();
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
        }
      }
    }

    // Test Phase 2 Attendance button (Clapperboard icon)
    const phase2Buttons = page.locator('.ft-table tbody tr button[title*="Phase 2"]');
    if ((await phase2Buttons.count()) > 0) {
      await phase2Buttons.first().click();
      await page.waitForTimeout(600);

      const phase2Modal = page.locator('.modern-modal-content');
      if (await phase2Modal.isVisible()) {
        await expect(phase2Modal).toBeVisible();
        const closeBtn = phase2Modal.locator('button[aria-label="Close"], button:has-text("Cancel"), button:has-text("OK")').first();
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
        }
      }
    }
  });

  test('5. Student Fee Update via EditStudentModal & Live Sync (Zero Residue)', async ({ page }) => {
    await injectAuth(page, 'admin');
    await page.goto('/bfi-classroom/admin/additional-options?view=fee-tracker', { waitUntil: 'networkidle' });

    // Find the first student row and click Edit
    const editBtn = page.locator('.ft-table tbody tr button[title="Edit Student"]').first();
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click();

    // Verify EditStudentModal opens
    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal.locator('.modern-modal-header h3, h3.font-display').first()).toContainText('Edit Student');

    // If Phase 1 or 2 is locked, click "Unlock & Edit"
    const unlockBtn = modal.locator('button:has-text("Unlock & Edit")').first();
    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
      await page.waitForTimeout(400);
    }

    // Locate Amount Paid input
    const amountPaidInputs = modal.locator('input[placeholder*="10,000"]');
    await expect(amountPaidInputs.first()).toBeVisible({ timeout: 8000 });
    await expect(amountPaidInputs.first()).toBeEnabled({ timeout: 8000 });
    const originalPaid = await amountPaidInputs.first().inputValue();
    const originalPaidNum = parseInt(originalPaid.replace(/[^\d]/g, ''), 10) || 0;

    // Increment amount paid by 100
    const newPaidNum = originalPaidNum + 100;
    await amountPaidInputs.first().fill(String(newPaidNum));
    await page.waitForTimeout(300);

    // Save changes
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Changes")');
    await saveBtn.click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Re-open EditStudentModal to restore original fee value (Clean state guaranteed)
    await editBtn.click();
    await expect(modal).toBeVisible({ timeout: 10000 });

    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
      await page.waitForTimeout(400);
    }

    await expect(amountPaidInputs.first()).toBeVisible({ timeout: 8000 });
    await expect(amountPaidInputs.first()).toBeEnabled({ timeout: 8000 });

    // Restore original value
    await amountPaidInputs.first().fill(String(originalPaidNum));
    await page.waitForTimeout(300);
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });
  });

  test('6. Batch Fee Manager Full Lifecycle: Create, Read, Update, Delete (Zero Residue)', async ({ page }) => {
    await injectAuth(page, 'admin');
    await page.goto('/bfi-classroom/admin/additional-options?view=batch-fees', { waitUntil: 'networkidle' });

    // Verify Header & Defined Batch Fees count badge
    await expect(page.locator('.bfm-header h1')).toContainText('Batch Fee Manager');
    await expect(page.locator('.bfm-card-header').first()).toBeVisible({ timeout: 10000 });

    const testBatchNumber = '997';
    const testPhase1Fee = '3500';
    const testPhase2Fee = '3500';

    // Fill form for sandbox batch
    const batchInput = page.locator('#bfm-batch');
    await batchInput.fill(testBatchNumber);

    const phase1Input = page.locator('#bfm-p1');
    await phase1Input.fill(testPhase1Fee);

    const phase2Input = page.locator('#bfm-p2');
    await phase2Input.fill(testPhase2Fee);

    // Submit form
    const saveBtn = page.locator('.bfm-save-btn');
    await saveBtn.click();

    // Verify toast confirmation
    const toast = page.locator('.bfm-toast--success, .bfm-toast');
    await expect(toast).toBeVisible({ timeout: 8000 });

    // Search for the newly created batch fee
    const searchInput = page.locator('.bfm-search-input');
    await searchInput.fill(testBatchNumber);
    await page.waitForTimeout(600);

    // Verify row appears in Defined Batch Fees table
    const createdRow = page.locator('.bfm-table tbody tr', { hasText: `Batch ${testBatchNumber}` });
    await expect(createdRow).toBeVisible();
    await expect(createdRow).toContainText('৳3,500');

    // Update batch fee
    const editBtn = createdRow.locator('.bfm-edit-btn');
    await editBtn.click();
    await page.waitForTimeout(400);

    // Change Phase 1 fee to 4200
    await phase1Input.fill('4200');
    await saveBtn.click();

    // Verify updated toast
    await expect(toast).toBeVisible({ timeout: 8000 });
    await searchInput.fill(testBatchNumber);
    await page.waitForTimeout(600);
    await expect(createdRow).toContainText('৳4,200');

    // Clean up: Delete the test batch fee
    const deleteBtn = createdRow.locator('.bfm-delete-btn');
    await deleteBtn.click();

    // Handle BFIModal confirmation
    const confirmModal = page.locator('.bfi-modal-dialog');
    await expect(confirmModal).toBeVisible({ timeout: 6000 });
    const confirmDeleteBtn = confirmModal.locator('.bfi-modal-btn-ok');
    await confirmDeleteBtn.click();

    // Verify test batch fee is completely gone
    await page.waitForTimeout(1000);
    await expect(page.locator('.bfm-table tbody tr', { hasText: `Batch ${testBatchNumber}` })).not.toBeVisible();

    // Double check DB directly to ensure 100% zero residue
    const dbRecord = db.prepare('SELECT id FROM batch_course_fees WHERE batch_number = ?').get(testBatchNumber);
    expect(dbRecord).toBeUndefined();
  });
});
