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

test.describe('Specialized Suite 2: End-to-End Database Write/Restore Lifecycle (Sandbox CRUD)', () => {
  test.setTimeout(180000);

  const timestamp = Date.now();
  const testPostText = `[PLAYWRIGHT_SANDBOX_POST_${timestamp}] Automated E2E verification test post`;
  const testCommentText = `[PLAYWRIGHT_SANDBOX_COMMENT_${timestamp}] Automated comment verification`;
  const testNoticeTitle = `[PW_NOTICE_${timestamp}] Sandbox Notice Title`;
  const testNoticeMsg = `Automated E2E notice content timestamp: ${timestamp}`;
  const testBatchNum = `99${String(timestamp).slice(-3)}`;
  const testBatchName = `[PW_BATCH] Sandbox Batch ${testBatchNum}`;

  test.afterAll(async ({ request }) => {
    // Ultimate safety cleanup: ensure all temporary test records are scrubbed from DB & trash
    const { token } = getTokenAndUser('admin', 'admin@abir');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      // 1. Clean any lingering sandbox posts
      const commRes = await request.get('/api/community/posts?page=1&limit=50', { headers });
      if (commRes.ok()) {
        const data = await commRes.json();
        const lingeringPosts = (data.posts || []).filter(p => (p.content || '').includes('[PLAYWRIGHT_SANDBOX_POST'));
        for (const p of lingeringPosts) {
          await request.delete(`/api/community/posts/${p.id}`, { headers });
        }
      }

      // 2. Permanently clean trash items matching sandbox prefixes
      for (const entity of ['posts', 'announcements', 'batches']) {
        const trashRes = await request.get(`/api/admin/trash/${entity}?t=${Date.now()}`, { headers });
        if (trashRes.ok()) {
          const tData = await trashRes.json();
          const items = (tData.items || []).filter(item => {
            const raw = JSON.stringify(item);
            return raw.includes('PLAYWRIGHT_SANDBOX') || raw.includes('[PW_');
          });
          for (const item of items) {
            await request.delete(`/api/admin/trash/permanent/${entity}/${item.id}`, { headers });
          }
        }
      }

      // 3. Clean any lingering batches matching test batch name
      const batchRes = await request.get('/api/batches', { headers });
      if (batchRes.ok()) {
        const bData = await batchRes.json();
        const batches = (bData.batches || []).filter(b => (b.batch_name || '').includes('[PW_BATCH]'));
        for (const b of batches) {
          await request.delete(`/api/admin/batches/${b.id}`, { headers });
          const trashBatches = await request.get(`/api/admin/trash/batches?t=${Date.now()}`, { headers });
          if (trashBatches.ok()) {
            const tbData = await trashBatches.json();
            const tbItem = (tbData.items || []).find(x => JSON.stringify(x).includes(b.batch_name));
            if (tbItem) {
              await request.delete(`/api/admin/trash/permanent/batches/${tbItem.id}`, { headers });
            }
          }
        }
      }
    } catch (cleanupErr) {
      console.warn('Safety teardown error (non-fatal):', cleanupErr);
    }
  });

  test('1. Community Post & Comment CRUD Lifecycle (Create -> Comment -> Soft-Delete -> Trash -> Restore -> Permanent Delete)', async ({ page }) => {
    await injectAuth(page, 'admin', 'admin@abir');

    // Step A: Navigate to Community
    await page.goto('/bfi-classroom/community', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Step B: Compose and Publish a New Post
    const composerTextarea = page.locator('textarea[placeholder*="What\'s on your mind"]').first();
    await expect(composerTextarea).toBeVisible();
    await composerTextarea.fill(testPostText);

    const postBtn = page.locator('button.btn-primary:has-text("Post")').first();
    await postBtn.click();
    await page.waitForTimeout(1800);

    // Step C: Verify Post Appears in Feed
    const postElement = page.locator(`.post-card:has-text("${testPostText}")`).first();
    await expect(postElement).toBeVisible();

    // Step D: Add a Comment to the Post
    const commentInput = postElement.locator('input[placeholder="Write a comment..."]').first();
    if (await commentInput.isVisible()) {
      await commentInput.fill(testCommentText);
      await commentInput.press('Enter');
      await page.waitForTimeout(1200);
      await expect(postElement.locator(`text="${testCommentText}"`)).toBeVisible();
    }

    // Step E: Soft-Delete Post via Post Action Menu
    const menuTrigger = postElement.locator('.post-menu-trigger').first();
    await menuTrigger.click();
    await page.waitForTimeout(300);

    const deletePostItem = postElement.locator('.post-menu-item.delete:has-text("Delete Post")').first();
    await expect(deletePostItem).toBeVisible();
    await deletePostItem.click();
    await page.waitForTimeout(400);

    // Confirm in BFIModalDialog
    const modalConfirmBtn = page.locator('.bfi-modal-footer button:has-text("Delete"), .bfi-modal-footer button:has-text("Confirm")').first();
    await expect(modalConfirmBtn).toBeVisible();
    await modalConfirmBtn.click();
    await page.waitForTimeout(1200);

    // Verify post is no longer in active feed
    await expect(page.locator(`.post-card:has-text("${testPostText}")`)).toBeHidden();

    // Step F: Navigate to Trash Manager (Posts Tab)
    await page.goto('/bfi-classroom/admin/additional-options?view=trash&tab=posts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Verify deleted post is listed in Trash (handle truncation with timestamp prefix)
    const trashItem = page.locator('.trash-item').filter({ hasText: `[PLAYWRIGHT_SANDBOX_POST_${timestamp}]` }).first();
    await expect(trashItem).toBeVisible();

    // Step G: Restore Post from Trash
    const restoreBtn = trashItem.locator('.trash-btn-restore').first();
    await restoreBtn.click();
    await page.waitForTimeout(400);

    const restoreConfirmBtn = page.locator('.bfi-modal-footer button:has-text("Confirm"), .bfi-modal-footer button:has-text("OK")').first();
    await expect(restoreConfirmBtn).toBeVisible();
    await restoreConfirmBtn.click();
    await page.waitForTimeout(1200);

    // Step H: Return to Community and Verify Post Restored
    await page.goto('/bfi-classroom/community', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const restoredPost = page.locator(`.post-card:has-text("${testPostText}")`).first();
    await expect(restoredPost).toBeVisible();

    // Step I: Final Soft-Delete and Permanent Delete Cleanup
    const menuTrigger2 = restoredPost.locator('.post-menu-trigger').first();
    await menuTrigger2.click();
    await page.waitForTimeout(300);
    await restoredPost.locator('.post-menu-item.delete:has-text("Delete Post")').first().click();
    await page.waitForTimeout(400);
    await page.locator('.bfi-modal-footer button:has-text("Delete"), .bfi-modal-footer button:has-text("Confirm")').first().click();
    await page.waitForTimeout(1000);

    // Permanent delete in Trash Manager
    await page.goto('/bfi-classroom/admin/additional-options?view=trash&tab=posts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const trashItemToDelete = page.locator('.trash-item').filter({ hasText: `[PLAYWRIGHT_SANDBOX_POST_${timestamp}]` }).first();
    if (await trashItemToDelete.isVisible()) {
      await trashItemToDelete.locator('.trash-btn-delete').first().click();
      await page.waitForTimeout(400);
      await page.locator('.bfi-modal-footer button:has-text("Confirm"), .bfi-modal-footer button:has-text("OK")').first().click();
      await page.waitForTimeout(1000);
    }
  });

  test('2. Notice Board Announcement CRUD Lifecycle (Create -> Notice Board View -> Soft-Delete -> Trash -> Permanent Cleanup)', async ({ page }) => {
    await injectAuth(page, 'admin', 'admin@abir');

    // Step A: Navigate to Announcements Manager
    await page.goto('/bfi-classroom/admin/announcements', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Ensure Standard Notice mode is selected
    const standardNoticeBtn = page.locator('button:has-text("Standard Notice")').first();
    if (await standardNoticeBtn.isVisible()) {
      await standardNoticeBtn.click();
      await page.waitForTimeout(300);
    }

    // Step B: Fill and Publish Notice
    const titleInput = page.locator('input[placeholder*="Exam Rescheduled"], input[placeholder*="Urgent Class Announcement"]').first();
    await expect(titleInput).toBeVisible();
    await titleInput.fill(testNoticeTitle);

    const msgInput = page.locator('textarea[placeholder*="Write your message to students"]').first();
    await expect(msgInput).toBeVisible();
    await msgInput.fill(testNoticeMsg);

    // Submit Announcement
    const publishBtn = page.locator('button:has-text("Send Now"), button:has-text("Post Notice"), button:has-text("Broadcast Now")').first();
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();
    await page.waitForTimeout(2000);

    // Step C: Verify Notice on Public Notice Board (/notices)
    await page.goto('/bfi-classroom/notices', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await expect(page.locator(`text="${testNoticeTitle}"`).first()).toBeVisible();

    // Step D: Return to Announcements and Soft-Delete the Notice
    await page.goto('/bfi-classroom/admin/announcements', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Find notice delete button
    const noticeRow = page.locator(`text="${testNoticeTitle}"`).first();
    if (await noticeRow.isVisible()) {
      const container = noticeRow.locator('xpath=ancestor::div[contains(@class, "bc-history-item") or contains(@class, "notice-card") or contains(@style, "display: flex")][1]');
      const deleteBtn = container.locator('button[title*="Delete"], button:has(svg.lucide-trash-2), button:has(svg.lucide-trash)').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.waitForTimeout(400);
        const confirmDeleteNotice = page.locator('.bfi-modal-footer button:has-text("Delete"), .bfi-modal-footer button:has-text("Confirm"), .bfi-modal-footer button:has-text("OK")').first();
        if (await confirmDeleteNotice.isVisible()) {
          await confirmDeleteNotice.click();
          await page.waitForTimeout(1200);
        }
      }
    }

    // Step E: Verify Notice in Trash Manager (Announcements Tab) and Permanently Delete
    await page.goto('/bfi-classroom/admin/additional-options?view=trash&tab=announcements', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const trashNoticeItem = page.locator('.trash-item').filter({ hasText: `[PW_NOTICE_${timestamp}]` }).first();
    if (await trashNoticeItem.isVisible()) {
      await trashNoticeItem.locator('.trash-btn-delete').first().click();
      await page.waitForTimeout(400);
      const permConfirm = page.locator('.bfi-modal-footer button:has-text("Confirm"), .bfi-modal-footer button:has-text("OK")').first();
      if (await permConfirm.isVisible()) {
        await permConfirm.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('3. Academic Batch CRUD Lifecycle (Create Batch -> Verify in Grid -> Soft-Delete -> Trash -> Permanent Cleanup)', async ({ page }) => {
    await injectAuth(page, 'admin', 'admin@abir');

    // Step A: Navigate to Batch Manager
    await page.goto('/bfi-classroom/admin/batchmanager', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Step B: Open Create Batch Modal
    const createBatchBtn = page.locator('button:has-text("Create New Batch")').first();
    await expect(createBatchBtn).toBeVisible();
    await createBatchBtn.click();
    await page.waitForTimeout(500);

    const modal = page.locator('.batch-modal-container');
    await expect(modal).toBeVisible();

    // Fill Batch Number and Batch Name
    const batchNumInput = modal.locator('input[placeholder="e.g. 86"]');
    await batchNumInput.fill(testBatchNum);

    const batchNameInput = modal.locator('input[placeholder="e.g. 86th Batch"]');
    await batchNameInput.fill(testBatchName);

    // Submit Create Batch
    const submitBtn = modal.locator('button[type="submit"]:has-text("Create Batch")');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();
    await page.waitForTimeout(1500);

    // Step C: Verify Batch Appears in Grid
    const batchCard = page.locator(`.batch-card:has-text("${testBatchName}")`).first();
    await expect(batchCard).toBeVisible();

    // Step D: Soft-Delete Batch via 3-dots Menu
    const dropdownTrigger = batchCard.locator('button[title="More Options"]').first();
    await dropdownTrigger.click();
    await page.waitForTimeout(300);

    const deleteBatchOption = page.locator('.dropdown-menu-custom button:has-text("Delete Batch")').first();
    await expect(deleteBatchOption).toBeVisible();
    await deleteBatchOption.click();
    await page.waitForTimeout(400);

    // Confirm inline delete popover
    const confirmPopoverBtn = batchCard.locator('.batch-confirm-popover button.btn-submit').first();
    await expect(confirmPopoverBtn).toBeVisible();
    await confirmPopoverBtn.click();
    await page.waitForTimeout(1500);

    // Verify batch is removed from batch grid
    await expect(page.locator(`.batch-card:has-text("${testBatchName}")`)).toBeHidden();

    // Step E: Verify in Trash Manager (Batches Tab) and Permanently Scrub
    await page.goto('/bfi-classroom/admin/additional-options?view=trash&tab=batches', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const trashBatchItem = page.locator('.trash-item').filter({ hasText: testBatchName }).first();
    if (await trashBatchItem.isVisible()) {
      await trashBatchItem.locator('.trash-btn-delete').first().click();
      await page.waitForTimeout(400);
      const permConfirm = page.locator('.bfi-modal-footer button:has-text("Confirm"), .bfi-modal-footer button:has-text("OK")').first();
      if (await permConfirm.isVisible()) {
        await permConfirm.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});
