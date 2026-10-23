import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { 
  assertIsolatedTestDatabase, 
  getTestDbPath, 
  initIsolatedTestDatabase, 
  getTestApiUrl, 
  verifyServerIsolation, 
  assertServerRejectionProof, 
  setupTestRouteProxy 
} from './test-db-isolation.js';

dotenv.config();

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);
const JWT_SECRET = process.env.JWT_SECRET?.trim() || 'test_secret_for_bfi_classroom_jwt';

let db;
let adminToken;
let adminUser;
let testStudentId;
let testCourseDefId;
let testBatchId;
let testEnrollmentId;

test.beforeAll(async () => {
  // 0. Verify test server isolation and rejection of production target
  await assertServerRejectionProof('http://127.0.0.1:3001');
  const serverIdentity = await verifyServerIsolation(getTestApiUrl());
  console.log(`[Fee UI Alignment Test] Connected to isolated test server: port=${serverIdentity.port} db=${serverIdentity.dbPath}`);

  await initIsolatedTestDatabase(DB_PATH);
  db = new Database(DB_PATH);
  assertIsolatedTestDatabase(db.name || DB_PATH);
  adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();

  adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: adminUser.role, name: `${adminUser.first_name} ${adminUser.last_name}` },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Clean old test records completely
  db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%'))").run();
  db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%'))").run();
  db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%'))").run();
  db.prepare("DELETE FROM batch_students WHERE student_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%')").run();
  db.prepare("DELETE FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%')").run();
  db.prepare("DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'feetest_%'").run();
  db.prepare("DELETE FROM batches WHERE batch_name LIKE 'FeeTest %'").run();
  db.prepare("DELETE FROM course_definitions WHERE name LIKE 'FeeTest %'").run();

  // 1. Create a test student
  const uRes = db.prepare(`
    INSERT INTO users (username, password_hash, first_name, last_name, email, role, is_active)
    VALUES ('feetest_student', '$2a$10$abcdefghijklmnopqrstuu', 'Tariq', 'Islam', 'tariq.feetest@example.com', 'student', 1)
  `).run();
  testStudentId = uRes.lastInsertRowid;
  db.prepare(`
    INSERT INTO student_profiles (user_id, student_id, full_name, batch_number)
    VALUES (?, 'FT001', 'Tariq Islam', 'FT01')
  `).run(testStudentId);

  // 2. Create a 2-phase course definition with 4000 fee per phase and phaseGates requiring fee
  const defJson = JSON.stringify({
    basics: {
      name: 'FeeTest Financial Alignment Masterclass',
      type: 'filmmaking',
      description: '2-phase course for fee UI verification',
      duration: { value: 4, unit: 'months' }
    },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Phase 1 - Fundamentals',
        classCount: 1,
        feeAmount: 4000,
        requirements: {
          attendanceRequired: false,
          completionRequired: true
        },
        classes: [
          { id: 'cls_ft_1', title: 'Intro Session', category: 'theory', mandatory: true }
        ],
        assignments: [],
        exam: { enabled: false }
      },
      {
        id: 'phase_2',
        phaseIndex: 2,
        title: 'Phase 2 - Production',
        classCount: 1,
        feeAmount: 4000,
        requirements: {
          attendanceRequired: false,
          completionRequired: true
        },
        classes: [
          { id: 'cls_ft_2', title: 'Set Work', category: 'practical', mandatory: true }
        ],
        assignments: [],
        exam: { enabled: false }
      }
    ],
    completionPolicy: {
      minPhasesToComplete: 2,
      certificateEligible: true,
      phaseGates: {
        phase_2: {
          previousPhasePassed: true,
          feePaid: true
        }
      }
    }
  });

  const cdRes = db.prepare(`
    INSERT INTO course_definitions (slug, name, course_type, phase_count, status, version, definition_json, created_by, updated_by)
    VALUES ('feetest-financial-alignment-masterclass', 'FeeTest Financial Alignment Masterclass', 'filmmaking', 2, 'published', 1, ?, ?, ?)
  `).run(defJson, adminUser.id, adminUser.id);
  testCourseDefId = cdRes.lastInsertRowid;

  // 3. Create a test batch linked to this published course definition
  const bRes = db.prepare(`
    INSERT INTO batches (batch_name, course_name, batch_number, course_definition_id, course_version, status, created_by)
    VALUES ('FeeTest Batch 01', 'FeeTest Financial Alignment Masterclass', 'FT01', ?, 1, 'ongoing', ?)
  `).run(testCourseDefId, adminUser.id);
  testBatchId = bRes.lastInsertRowid;

  // 4. Enroll test student in the course
  const eRes = db.prepare(`
    INSERT INTO student_course_enrollments (
      user_id, course_name, course_type, course_definition_id, course_version, batch_id,
      fee_details
    ) VALUES (?, 'FeeTest Financial Alignment Masterclass', 'filmmaking', ?, 1, ?, ?)
  `).run(
    testStudentId, 
    testCourseDefId, 
    testBatchId,
    JSON.stringify({
      full_fee: 4000,
      amount_paid: 0,
      discount: 0,
      status: 'Pending',
      installments: []
    })
  );
  testEnrollmentId = eRes.lastInsertRowid;

  db.prepare(`
    INSERT INTO batch_students (batch_id, student_id, assigned_by)
    VALUES (?, ?, ?)
  `).run(testBatchId, testStudentId, adminUser.id);
});

test.afterAll(() => {
  if (db) {
    db.prepare("DELETE FROM student_class_attendance WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%'))").run();
    db.prepare("DELETE FROM student_assignment_grades WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%'))").run();
    db.prepare("DELETE FROM student_phase_results WHERE enrollment_id IN (SELECT id FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%'))").run();
    db.prepare("DELETE FROM batch_students WHERE student_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%')").run();
    db.prepare("DELETE FROM student_course_enrollments WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%')").run();
    db.prepare("DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'feetest_%')").run();
    db.prepare("DELETE FROM users WHERE username LIKE 'feetest_%'").run();
    db.prepare("DELETE FROM batches WHERE batch_name LIKE 'FeeTest %'").run();
    db.prepare("DELETE FROM course_definitions WHERE name LIKE 'FeeTest %'").run();
    db.close();
  }
});

async function injectAdminAuth(page) {
  await setupTestRouteProxy(page);
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('auth_user_cache', JSON.stringify(user));
  }, {
    token: adminToken,
    user: { id: adminUser.id, username: adminUser.username, role: 'admin', first_name: adminUser.first_name, last_name: adminUser.last_name }
  });
}

test.describe('Course Maker Financial UI Alignment & Browser Verification', () => {

  test('1. Discounted plan with unpaid installments exceeding true due displays true net balance and saves correctly', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students', { waitUntil: 'networkidle' });

    // Find student Tariq Islam
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Tariq Islam');
    }

    const studentRow = page.locator('tr', { hasText: 'Tariq Islam' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    // Click Edit Student button
    const editBtn = studentRow.locator('button[title="Edit Student"]');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal).toContainText('Edit Student');

    // Unlock if locked
    const unlockBtn = modal.locator('button:has-text("Unlock & Edit")').first();
    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
      await page.waitForTimeout(300);
    }

    // Set Course Fee: 4000
    const fullFeeInput = modal.locator('input[placeholder*="15,000"]').first();
    if (await fullFeeInput.isVisible() && await fullFeeInput.isEnabled()) {
      await fullFeeInput.fill('4000');
    }

    // Set Discount: 1000
    const discountInput = modal.locator('input[placeholder*="2,000 or 10%"]').first();
    await discountInput.fill('1000');
    await discountInput.blur();
    await page.waitForTimeout(200);

    // Set Amount Paid: 1000
    const amountPaidInput = modal.locator('input[placeholder*="10,000"]').first();
    await amountPaidInput.fill('1000');
    await page.waitForTimeout(200);

    // Click + Add Installment and enter 3000 (which exceeds the remaining 2000 due)
    const addInstBtn = modal.locator('button:has-text("+ Add Installment")').first();
    await addInstBtn.click();
    await page.waitForTimeout(200);

    const instAmountInput = modal.locator('input[placeholder="Amount"]').first();
    await instAmountInput.fill('3000');
    await page.waitForTimeout(200);

    // ASSERT Financial Summary displays:
    // Net Payable: ৳3,000 (4000 - 1000)
    // Cash Collected: ৳1,000
    // Remaining Due: ৳2,000 (NOT ৳3,000 from the oversized installment!)
    await expect(modal).toContainText('Net Payable');
    await expect(modal).toContainText('৳3,000');
    await expect(modal).toContainText('Cash Collected');
    await expect(modal).toContainText('৳1,000');
    await expect(modal).toContainText('Remaining Due');
    await expect(modal).toContainText('৳2,000');

    // Installment Details header must show Due: ৳2,000
    await expect(modal).toContainText('Due: ৳2,000');

    // Save changes
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Changes")');
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // REFRESH browser page and verify persistence
    await page.reload({ waitUntil: 'networkidle' });
    const studentRowAfter = page.locator('tr', { hasText: 'Tariq Islam' });
    await expect(studentRowAfter).toBeVisible({ timeout: 10000 });

    // Re-open Edit Student modal and verify the displayed values after refresh
    await studentRowAfter.locator('button[title="Edit Student"]').click();
    await expect(modal).toBeVisible({ timeout: 5000 });

    await expect(modal).toContainText('Net Payable');
    await expect(modal).toContainText('৳3,000');
    await expect(modal).toContainText('Remaining Due');
    await expect(modal).toContainText('৳2,000');

    // Close modal
    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).not.toBeVisible();
  });

  test('2. Underfunded plan whose listed installments are all Paid does NOT show fee completed and keeps gates locked', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students', { waitUntil: 'networkidle' });

    const studentRow = page.locator('tr', { hasText: 'Tariq Islam' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    await studentRow.locator('button[title="Edit Student"]').click();
    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Unlock if locked
    const unlockBtn = modal.locator('button:has-text("Unlock & Edit")').first();
    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
      await page.waitForTimeout(300);
    }

    // Set Course Fee: 4000, Discount: 0, Amount Paid: 0
    const fullFeeInput = modal.locator('input[placeholder*="15,000"]').first();
    if (await fullFeeInput.isVisible() && await fullFeeInput.isEnabled()) {
      await fullFeeInput.fill('4000');
    }
    const discountInput = modal.locator('input[placeholder*="2,000 or 10%"]').first();
    await discountInput.fill('0');
    await discountInput.blur();

    const amountPaidInput = modal.locator('input[placeholder*="10,000"]').first();
    await amountPaidInput.fill('0');

    // Set Installment: Amount 1000, Status Paid
    const instAmountInput = modal.locator('input[placeholder="Amount"]').first();
    await instAmountInput.fill('1000');
    const instStatusSelect = modal.locator('select').filter({ hasText: 'Pending' }).filter({ hasNotText: 'Paid Full' }).first();
    await instStatusSelect.selectOption('Paid');
    await page.waitForTimeout(300);

    // ASSERT:
    // Remaining Due is ৳3,000
    await expect(modal).toContainText('Remaining Due');
    await expect(modal).toContainText('৳3,000');
    // Does NOT say "1st Phase fee completed" or show "Paid" badge because 3000 is still due!
    await expect(modal.locator('span', { hasText: /^Paid$/ })).not.toBeVisible();

    // Save changes
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Changes")');
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // REFRESH browser page
    await page.reload({ waitUntil: 'networkidle' });

    // Open DefinedCourseProgressModal by clicking P1
    const p1Btn = page.locator('tr', { hasText: 'Tariq Islam' }).locator('button', { hasText: 'P1' });
    await expect(p1Btn).toBeVisible();
    await p1Btn.click();

    const progressModal = page.locator('.defined-course-progress-modal');
    await expect(progressModal).toBeVisible({ timeout: 5000 });

    // Verify Phase Fee Status Bar shows Partial and Due: ৳3,000
    await expect(progressModal).toContainText('Due: ৳3,000');
    await expect(progressModal).toContainText('Partial');

    // Switch to Phase 2 tab
    const p2Tab = progressModal.locator('button', { hasText: 'Phase 2' });
    await p2Tab.click();

    // Verify Phase Progression Blocked banner is present because Phase 1 fee is NOT fully paid!
    await expect(progressModal).toContainText('Phase Progression Blocked');
    await expect(progressModal).toContainText('Phase 2 Status: Locked');

    // Close progress modal
    await progressModal.locator('button[aria-label="Close modal"]').click();
    await expect(progressModal).not.toBeVisible();
  });

  test('3. Cumulative amount_paid alongside paid installments does NOT double count cash', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students', { waitUntil: 'networkidle' });

    const studentRow = page.locator('tr', { hasText: 'Tariq Islam' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    await studentRow.locator('button[title="Edit Student"]').click();
    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const unlockBtn = modal.locator('button:has-text("Unlock & Edit")').first();
    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
      await page.waitForTimeout(300);
    }

    // Set Amount Paid: 2000
    const amountPaidInput = modal.locator('input[placeholder*="10,000"]').first();
    await amountPaidInput.fill('2000');

    // Installment: 2000 Paid
    const instAmountInput = modal.locator('input[placeholder="Amount"]').first();
    await instAmountInput.fill('2000');
    await page.waitForTimeout(300);

    // ASSERT:
    // Cash Collected is ৳2,000 (NOT 2000 + 2000 = 4000!)
    // Remaining Due is ৳2,000 (NOT ৳0!)
    await expect(modal).toContainText('Cash Collected');
    await expect(modal).toContainText('৳2,000');
    await expect(modal).toContainText('Remaining Due');
    await expect(modal).toContainText('৳2,000');

    // Save changes
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Changes")');
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // Refresh and re-open to confirm persistence
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('tr', { hasText: 'Tariq Islam' }).locator('button[title="Edit Student"]').click();
    await expect(modal).toBeVisible({ timeout: 5000 });

    await expect(modal).toContainText('Cash Collected');
    await expect(modal).toContainText('৳2,000');
    await expect(modal).toContainText('Remaining Due');
    await expect(modal).toContainText('৳2,000');

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).not.toBeVisible();
  });

  test('4. Overpayment policy displays surplus credit, allows saving without error, and unlocks fee gate', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students', { waitUntil: 'networkidle' });

    const studentRow = page.locator('tr', { hasText: 'Tariq Islam' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    await studentRow.locator('button[title="Edit Student"]').click();
    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const unlockBtn = modal.locator('button:has-text("Unlock & Edit")').first();
    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
      await page.waitForTimeout(300);
    }

    // Set Course Fee: 4000
    const fullFeeInput = modal.locator('input[placeholder*="15,000"]').first();
    if (await fullFeeInput.isVisible() && await fullFeeInput.isEnabled()) {
      await fullFeeInput.fill('4000');
    }

    // Enter Amount Paid: 5000 (overpayment of 1000)
    const amountPaidInput = modal.locator('input[placeholder*="10,000"]').first();
    await amountPaidInput.fill('5000');
    await page.waitForTimeout(300);

    // ASSERT:
    // 1. Red error "Amount paid cannot exceed the course fee" must NOT exist
    await expect(modal.locator('text=Amount paid cannot exceed the course fee')).not.toBeVisible();

    // 2. Clear surplus notice is displayed
    await expect(modal).toContainText('Surplus Payment');
    await expect(modal).toContainText('৳1,000');

    // 3. Summary row shows: Net Payable ৳4,000, Cash Collected ৳5,000, Remaining Due ৳0, Overpayment +৳1,000
    await expect(modal).toContainText('Remaining Due');
    await expect(modal).toContainText('৳0');
    await expect(modal).toContainText('Overpayment');
    await expect(modal).toContainText('+৳1,000');

    // 4. "Paid" badge is displayed
    await expect(modal.locator('span', { hasText: /^Paid$/ })).toBeVisible();

    // Save changes - MUST succeed with HTTP 200, no validation block!
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Changes")');
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // REFRESH browser page
    await page.reload({ waitUntil: 'networkidle' });

    // Re-open Edit Student modal and verify overpayment persistence
    await page.locator('tr', { hasText: 'Tariq Islam' }).locator('button[title="Edit Student"]').click();
    await expect(modal).toBeVisible({ timeout: 5000 });

    await expect(modal).toContainText('+৳1,000');
    await expect(modal).toContainText('৳0');
    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).not.toBeVisible();

    // Now open DefinedCourseProgressModal:
    const p1Btn = page.locator('tr', { hasText: 'Tariq Islam' }).locator('button', { hasText: 'P1' });
    await p1Btn.click();

    const progressModal = page.locator('.defined-course-progress-modal');
    await expect(progressModal).toBeVisible({ timeout: 5000 });

    // Verify Phase Fee Status Bar shows Paid Full with ৳0 due
    await expect(progressModal).toContainText('Paid Full');
    await expect(progressModal).not.toContainText('Due:');

    // Close progress modal
    await progressModal.locator('button[aria-label="Close modal"]').click();
    await expect(progressModal).not.toBeVisible();
  });


  test('5. Misleading Paid status with an outstanding balance displays true remaining due and keeps later phase locked', async ({ page }) => {
    // Set Phase 1 full_fee: 5000, amount_paid: 0, status: 'Paid', with Phase 2 full_fee: 4000
    db.prepare(`
      UPDATE student_course_enrollments 
      SET fee_details = ? 
      WHERE id = ?
    `).run(JSON.stringify({
      phase1: { full_fee: 5000, amount_paid: 0, status: 'Paid', installments: [] },
      phase2: { full_fee: 4000, amount_paid: 0, status: 'Pending', installments: [] }
    }), testEnrollmentId);

    // Ensure Phase 1 is not passed in student_phase_results
    db.prepare(`
      DELETE FROM student_phase_results WHERE enrollment_id = ?
    `).run(testEnrollmentId);

    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students', { waitUntil: 'networkidle' });

    const studentRow = page.locator('tr', { hasText: 'Tariq Islam' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    await studentRow.locator('button[title="Edit Student"]').click();
    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Assert Phase 1 displays true financial facts:
    // Net Payable: ৳5,000, Cash Collected: ৳0, Remaining Due: ৳5,000
    await expect(modal).toContainText('Net Payable');
    await expect(modal).toContainText('৳5,000');
    await expect(modal).toContainText('Remaining Due');
    // Does NOT say "1st Phase fee completed"
    await expect(modal).not.toContainText('1st Phase fee completed');

    // Assert Phase 2 is locked because Phase 1 is not paid (and not passed)
    await expect(modal).toContainText('Locked:');
    await expect(modal).toContainText('Phase 1 fee fully paid required');

    // Phase 2 inputs are disabled
    const unlockButtons = modal.locator('button:has-text("Unlock & Edit")');
    await expect(unlockButtons.first()).toBeVisible();

    // Click Unlock & Edit to trigger explicit admin override
    await unlockButtons.first().click();
    await page.waitForTimeout(200);

    // Overridden badge is shown
    await expect(modal).toContainText('Lock Overridden by Admin (Authorized)');

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).not.toBeVisible();
  });

  test('6. Paid installment plus direct payment reconciles cash collected without double counting and syncs step1_completed', async ({ page }) => {
    // Create a legacy workshop enrollment for Tariq Islam
    const legacyCourseName = 'Film Appreciation Course';
    db.prepare(`DELETE FROM student_course_enrollments WHERE user_id = ? AND course_name = ?`).run(testStudentId, legacyCourseName);
    
    db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, step1_completed, fee_details
      ) VALUES (?, ?, 'workshop', 0, ?)
    `).run(
      testStudentId,
      legacyCourseName,
      JSON.stringify({
        full_fee: 6000,
        direct_payment: 2000,
        amount_paid: 2000,
        discount: 0,
        status: 'Partial',
        installments: [
          { amount: '2000', dueDate: '2026-11-15', status: 'Paid' },
          { amount: '2000', dueDate: '2026-12-15', status: 'Pending' }
        ]
      })
    );

    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students', { waitUntil: 'networkidle' });

    const studentRow = page.locator('tr', { hasText: 'Tariq Islam' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    await studentRow.locator('button[title="Edit Student"]').click();
    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Assert Film Appreciation Course fee row:
    // Gross: ৳6,000
    // Cash Collected: ৳4,000 (2000 direct + 2000 paid installment, NOT double counted)
    // Remaining Due: ৳2,000
    await expect(modal).toContainText('Film Appreciation Course');
    await expect(modal).toContainText('৳6,000');
    await expect(modal).toContainText('৳4,000');
    await expect(modal).toContainText('৳2,000');

    // Save changes
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Changes")');
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // Verify in database: step1_completed was auto-synced to 1 because cashCollected = 4000 > 0
    const legacyEnr = db.prepare(`
      SELECT step1_completed, fee_details 
      FROM student_course_enrollments 
      WHERE user_id = ? AND course_name = ?
    `).get(testStudentId, legacyCourseName);

    expect(legacyEnr.step1_completed).toBe(1);

    // Clean up legacy enrollment
    db.prepare(`DELETE FROM student_course_enrollments WHERE user_id = ? AND course_name = ?`).run(testStudentId, legacyCourseName);
  });

  test('7. Opening and saving without edits preserves existing installments and fee history without phantom mutations', async ({ page }) => {
    // Set upfront payment full_fee: 4000, amount_paid: 4000 with 2 future planned installments
    const originalFee = {
      full_fee: 4000,
      amount_paid: 4000,
      discount: 0,
      status: 'Paid Full',
      installments: [
        { amount: '2000', dueDate: '2026-11-01', status: 'Pending' },
        { amount: '2000', dueDate: '2026-12-01', status: 'Pending' }
      ]
    };

    db.prepare(`
      UPDATE student_course_enrollments 
      SET fee_details = ? 
      WHERE id = ?
    `).run(JSON.stringify(originalFee), testEnrollmentId);

    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students', { waitUntil: 'networkidle' });

    const studentRow = page.locator('tr', { hasText: 'Tariq Islam' });
    await expect(studentRow).toBeVisible({ timeout: 10000 });

    await studentRow.locator('button[title="Edit Student"]').click();
    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify modal is loaded
    await expect(modal.locator('input[name="firstName"]')).toHaveValue('Tariq');

    // IMMEDIATELY click Save Changes without modifying anything
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Changes")');
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // Query database: verify installments were NOT wiped or corrupted
    const savedEnr = db.prepare(`
      SELECT fee_details FROM student_course_enrollments WHERE id = ?
    `).get(testEnrollmentId);

    const savedDetails = JSON.parse(savedEnr.fee_details);
    const savedInst = savedDetails.installments || savedDetails.phase1?.installments || [];

    expect(savedInst.length).toBe(2);
    expect(savedInst[0].amount).toBe('2000');
    expect(savedInst[0].dueDate).toBe('2026-11-01');
    expect(savedInst[0].status).toBe('Pending');
    expect(savedInst[1].amount).toBe('2000');
    expect(savedInst[1].dueDate).toBe('2026-12-01');
    expect(savedInst[1].status).toBe('Pending');
  });

  test('8. Multi-phase progression across a 3-phase course enforces upstream gate locks and downstream payment locks', async ({ page }) => {
    // 1. Create a 3-phase course definition
    const triDefJson = JSON.stringify({
      basics: {
        name: 'FeeTest TriPhase Production Pipeline',
        type: 'filmmaking',
        description: '3-phase course for multi-phase gating verification',
        duration: { value: 6, unit: 'months' }
      },
      phases: [
        {
          id: 'p1_screenplay',
          phaseIndex: 1,
          title: 'Phase 1 - Screenplay',
          classCount: 1,
          feeAmount: 3000,
          requirements: { attendanceRequired: false, completionRequired: true },
          classes: [{ id: 'c1', title: 'Scriptwriting', category: 'theory', mandatory: true }],
          assignments: [],
          exam: { enabled: false }
        },
        {
          id: 'p2_direction',
          phaseIndex: 2,
          title: 'Phase 2 - Direction',
          classCount: 1,
          feeAmount: 3000,
          requirements: { attendanceRequired: false, completionRequired: true },
          classes: [{ id: 'c2', title: 'Directing', category: 'practical', mandatory: true }],
          assignments: [],
          exam: { enabled: false }
        },
        {
          id: 'p3_post',
          phaseIndex: 3,
          title: 'Phase 3 - Post Production',
          classCount: 1,
          feeAmount: 3000,
          requirements: { attendanceRequired: false, completionRequired: true },
          classes: [{ id: 'c3', title: 'Editing & VFX', category: 'post', mandatory: true }],
          assignments: [],
          exam: { enabled: false }
        }
      ],
      completionPolicy: {
        minPhasesToComplete: 3,
        certificateEligible: true,
        phaseGates: {
          phase_2: { previousPhasePassed: true, feePaid: true },
          phase_3: { previousPhasePassed: true, feePaid: true }
        }
      }
    });

    const triDefRes = db.prepare(`
      INSERT INTO course_definitions (slug, name, course_type, phase_count, status, version, definition_json, created_by, updated_by)
      VALUES ('feetest-triphase-pipeline', 'FeeTest TriPhase Production Pipeline', 'filmmaking', 3, 'published', 1, ?, ?, ?)
    `).run(triDefJson, adminUser.id, adminUser.id);
    const triDefId = triDefRes.lastInsertRowid;

    // Create batch
    const triBatchRes = db.prepare(`
      INSERT INTO batches (batch_name, course_name, batch_number, course_definition_id, course_version, status, created_by)
      VALUES ('FeeTest TriBatch 01', 'FeeTest TriPhase Production Pipeline', 'FT03', ?, 1, 'ongoing', ?)
    `).run(triDefId, adminUser.id);
    const triBatchId = triBatchRes.lastInsertRowid;

    // Create student
    const triStudentRes = db.prepare(`
      INSERT INTO users (username, password_hash, first_name, last_name, email, role, is_active)
      VALUES ('feetest_triphase_student', '$2a$10$abcdefghijklmnopqrstuu', 'Naveed', 'Akhtar', 'naveed.triphase@example.com', 'student', 1)
    `).run();
    const triStudentId = triStudentRes.lastInsertRowid;

    db.prepare(`
      INSERT INTO student_profiles (user_id, student_id, full_name, batch_number)
      VALUES (?, 'BFI88732026', 'Naveed Akhtar', '73')
    `).run(triStudentId);

    // Initial enroll with unpaid phases
    const triEnrRes = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, course_definition_id, course_version, batch_id,
        fee_details
      ) VALUES (?, 'FeeTest TriPhase Production Pipeline', 'filmmaking', ?, 1, ?, ?)
    `).run(
      triStudentId,
      triDefId,
      triBatchId,
      JSON.stringify({
        phase1: { full_fee: 3000, amount_paid: 0, status: 'Pending', installments: [] },
        phase2: { full_fee: 3000, amount_paid: 0, status: 'Pending', installments: [] },
        phase3: { full_fee: 3000, amount_paid: 0, status: 'Pending', installments: [] }
      })
    );
    const triEnrId = triEnrRes.lastInsertRowid;

    db.prepare(`
      INSERT INTO batch_students (batch_id, student_id, assigned_by)
      VALUES (?, ?, ?)
    `).run(triBatchId, triStudentId, adminUser.id);

    await injectAdminAuth(page);
    await page.goto('/bfi-classroom/admin/students', { waitUntil: 'networkidle' });

    // Find student Naveed Akhtar
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Naveed Akhtar');
    }

    const triStudentRow = page.locator('tr', { hasText: 'Naveed Akhtar' });
    await expect(triStudentRow).toBeVisible({ timeout: 10000 });

    await triStudentRow.locator('button[title="Edit Student"]').click();
    const modal = page.locator('.modern-modal-content');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Assert Phase 1 is editable (Phase 1 has no previous phase)
    // Assert Phase 2 is locked (Upstream lock: Phase 1 fee fully paid required)
    await expect(modal).toContainText('Phase 1');
    await expect(modal).toContainText('Phase 2');
    await expect(modal).toContainText('Phase 3');
    await expect(modal).toContainText('Phase 1 fee fully paid required');
    await expect(modal).toContainText('Phase 2 fee fully paid required');

    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).not.toBeVisible();

    // Now test Downstream Payment Lock:
    // Record payment in Phase 3
    db.prepare(`
      UPDATE student_course_enrollments
      SET fee_details = ?
      WHERE id = ?
    `).run(
      JSON.stringify({
        phase1: { full_fee: 3000, amount_paid: 0, status: 'Pending', installments: [] },
        phase2: { full_fee: 3000, amount_paid: 0, status: 'Pending', installments: [] },
        phase3: { full_fee: 3000, amount_paid: 1000, status: 'Partial', installments: [] }
      }),
      triEnrId
    );

    await page.reload({ waitUntil: 'networkidle' });
    if (await searchInput.isVisible()) {
      await searchInput.fill('Naveed Akhtar');
    }
    const triStudentRow2 = page.locator('tr', { hasText: 'Naveed Akhtar' });
    await triStudentRow2.locator('button[title="Edit Student"]').click();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Downstream lock message: Phase 3 has recorded payments
    await expect(modal).toContainText('Locked: Phase 3 has recorded payments');

    // Admin override test: Click Unlock & Edit on Phase 1
    const unlockBtn = modal.locator('button:has-text("Unlock & Edit")').first();
    await unlockBtn.click();
    await page.waitForTimeout(200);

    await expect(modal).toContainText('Lock Overridden by Admin (Authorized)');

    // Save with override
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Changes")');
    await saveBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // Clean up
    db.prepare(`DELETE FROM student_phase_results WHERE enrollment_id = ?`).run(triEnrId);
    db.prepare(`DELETE FROM batch_students WHERE student_id = ?`).run(triStudentId);
    db.prepare(`DELETE FROM student_course_enrollments WHERE id = ?`).run(triEnrId);
    db.prepare(`DELETE FROM student_profiles WHERE user_id = ?`).run(triStudentId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(triStudentId);
    db.prepare(`DELETE FROM batches WHERE id = ?`).run(triBatchId);
    db.prepare(`DELETE FROM course_definitions WHERE id = ?`).run(triDefId);
  });

});
