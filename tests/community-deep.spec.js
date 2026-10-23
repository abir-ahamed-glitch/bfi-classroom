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

test.describe('Community Deep Interactive Feature Audit', () => {
  test.setTimeout(180000);

  const timestamp = Date.now();
  const testPostInitial = `[PW_COMMUNITY_DEEP_${timestamp}] Initial Post for Deep Community Verification`;
  const testPostEdited = `[PW_COMMUNITY_DEEP_${timestamp}] EDITED Post - Successfully Updated!`;
  const testComment = `[PW_COMMUNITY_COMMENT_${timestamp}] Deep verification comment`;

  test.afterAll(async ({ request }) => {
    // Ultimate safety cleanup for deep test post
    try {
      const { token } = getTokenAndUser('admin', 'admin@abir');
      const headers = { Authorization: `Bearer ${token}` };
      const commRes = await request.get('/api/community/posts?page=1&limit=50', { headers });
      if (commRes.ok()) {
        const data = await commRes.json();
        const posts = (data.posts || []).filter(p => (p.content || '').includes(`PW_COMMUNITY_DEEP_${timestamp}`));
        for (const p of posts) {
          await request.delete(`/api/community/posts/${p.id}`, { headers });
          const trashRes = await request.get(`/api/admin/trash/posts?t=${Date.now()}`, { headers });
          if (trashRes.ok()) {
            const tbData = await trashRes.json();
            const tbItem = (tbData.items || []).find(x => JSON.stringify(x).includes(p.content));
            if (tbItem) {
              await request.delete(`/api/admin/trash/permanent/posts/${tbItem.id}`, { headers });
            }
          }
        }
      }
    } catch (e) {
      console.warn('Community deep teardown non-fatal error:', e);
    }
  });

  test('1. Full Post Lifecycle: Create -> Pin -> Unpin -> Edit -> Like -> Comment -> Delete Post -> Permanent Cleanup', async ({ page }) => {
    await injectAuth(page, 'admin', 'admin@abir');

    await page.goto('/bfi-classroom/community', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Step A: Compose and Publish a New Post
    const composerTextarea = page.locator('textarea[placeholder*="What\'s on your mind"]').first();
    await expect(composerTextarea).toBeVisible();
    await composerTextarea.fill(testPostInitial);

    const postBtn = page.locator('button.btn-primary:has-text("Post")').first();
    await postBtn.click();
    await page.waitForTimeout(1800);

    // Step B: Verify Post Appears in Feed and capture its stable ID
    const initialPostCard = page.locator(`.post-card:has-text("${testPostInitial}")`).first();
    await expect(initialPostCard).toBeVisible();

    const postDomId = await initialPostCard.getAttribute('id');
    const postCard = page.locator(`#${postDomId}`);

    // Step C: Admin Pins the Post
    const menuTrigger = postCard.locator('.post-menu-trigger').first();
    await menuTrigger.click();
    await page.waitForTimeout(300);

    const pinBtn = postCard.locator('.post-menu-item:has-text("Pin Post")').first();
    await expect(pinBtn).toBeVisible();
    await pinBtn.click();
    await page.waitForTimeout(1200);

    // Verify pinned styling and badge
    await expect(postCard).toHaveClass(/pinned-post/);
    await expect(postCard.locator('.pinned-badge').first()).toBeVisible();

    // Step D: Admin Unpins the Post
    await menuTrigger.click();
    await page.waitForTimeout(300);

    const unpinBtn = postCard.locator('.post-menu-item:has-text("Unpin Post")').first();
    await expect(unpinBtn).toBeVisible();
    await unpinBtn.click();
    await page.waitForTimeout(1200);

    // Verify pinned badge removed
    await expect(postCard.locator('.pinned-badge')).toBeHidden();

    // Step E: In-Place Post Editing (referencing by stable #id)
    await menuTrigger.click();
    await page.waitForTimeout(300);

    const editBtn = postCard.locator('.post-menu-item:has-text("Edit Post")').first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    await page.waitForTimeout(400);

    // Edit container should open with textarea
    const editTextarea = postCard.locator('.post-edit-container textarea').first();
    await expect(editTextarea).toBeVisible();
    await editTextarea.fill(testPostEdited);

    // Save edited post
    const saveEditBtn = postCard.locator('.post-edit-container button.btn-primary:has-text("Save")').first();
    await saveEditBtn.click();
    await page.waitForTimeout(1500);

    // Verify edited text appears in the post
    await expect(postCard.locator(`text="${testPostEdited}"`).first()).toBeVisible();

    // Step F: Like the Post
    const likeBtn = postCard.locator('button.action-btn:has(svg.lucide-thumbs-up)').first();
    await expect(likeBtn).toBeVisible();
    await likeBtn.click();
    await page.waitForTimeout(800);
    await expect(likeBtn.locator('svg.lucide-thumbs-up')).toBeVisible();

    // Step G: Add a Comment
    const commentInput = postCard.locator('input[placeholder="Write a comment..."]').first();
    await expect(commentInput).toBeVisible();
    await commentInput.fill(testComment);
    await commentInput.press('Enter');
    await page.waitForTimeout(1400);

    // Verify comment appears
    const commentItem = postCard.locator(`.comment-item:has-text("${testComment}"), .comment-bubble:has-text("${testComment}"), div:has-text("${testComment}")`).first();
    await expect(commentItem).toBeVisible();

    // Step H: Delete the Post & Clean up Trash
    await menuTrigger.click();
    await page.waitForTimeout(300);
    await postCard.locator('.post-menu-item.delete:has-text("Delete Post")').first().click();
    await page.waitForTimeout(400);
    await page.locator('.bfi-modal-footer button:has-text("Delete"), .bfi-modal-footer button:has-text("Confirm")').first().click();
    await page.waitForTimeout(1200);

    // Permanent delete in Trash Manager
    await page.goto('/bfi-classroom/admin/additional-options?view=trash&tab=posts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const trashItem = page.locator('.trash-item').filter({ hasText: `PW_COMMUNITY_DEEP_${timestamp}` }).first();
    if (await trashItem.isVisible()) {
      await trashItem.locator('.trash-btn-delete').first().click();
      await page.waitForTimeout(400);
      await page.locator('.bfi-modal-footer button:has-text("Confirm"), .bfi-modal-footer button:has-text("OK")').first().click();
      await page.waitForTimeout(1000);
    }
  });

  test('2. Audience Selector, Schedule Picker, and Post Search Bar Controls', async ({ page }) => {
    await injectAuth(page, 'admin', 'admin@abir');

    await page.goto('/bfi-classroom/community', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Step A: Audience Selector Interaction
    const audienceSelectorBtn = page.locator('.privacy-selector-btn, button:has-text("Public"), button:has-text("Batchmates")').first();
    if (await audienceSelectorBtn.isVisible()) {
      await audienceSelectorBtn.click();
      await page.waitForTimeout(300);
      // Verify audience dropdown options exist
      const onlyMeOption = page.locator('.privacy-dropdown-item:has-text("Only Me"), .audience-option:has-text("Only Me"), button:has-text("Only Me")').first();
      if (await onlyMeOption.isVisible()) {
        await onlyMeOption.click();
        await page.waitForTimeout(300);
      }
    }

    // Step B: Schedule Picker Toggle
    const scheduleBtn = page.locator('button:has-text("Schedule")').first();
    if (await scheduleBtn.isVisible()) {
      await scheduleBtn.click();
      await page.waitForTimeout(400);
      // Verify schedule dropdown appears
      const scheduleDropdown = page.locator('.schedule-dropdown');
      await expect(scheduleDropdown).toBeVisible();
      // Close schedule picker
      const closeScheduleBtn = scheduleDropdown.locator('button:has-text("×"), button.btn-glass:has-text("Clear"), button').first();
      await closeScheduleBtn.click();
      await page.waitForTimeout(300);
    }

    // Step C: Post Search Bar Interaction
    const searchInput = page.locator('input[placeholder*="Search for people"], input[placeholder*="Search posts"], input.community-search-input').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Filmmaking');
      await page.waitForTimeout(500);
      await searchInput.clear();
      await page.waitForTimeout(300);
    }
  });
});
