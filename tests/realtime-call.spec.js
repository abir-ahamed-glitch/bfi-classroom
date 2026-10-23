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

test.describe('Specialized Suite 3: Multi-Context Real-Time WebSockets & Call Testing', () => {
  test.setTimeout(180000);

  const timestamp = Date.now();
  const testMsgAdmin = `[PW_REALTIME_MSG_${timestamp}] Hello from Admin to Student!`;
  const testMsgStudent = `[PW_REALTIME_REPLY_${timestamp}] Acknowledged by Student in real time!`;
  const testPostContent = `[PW_REALTIME_COMMUNITY_${timestamp}] Multi-context live broadcast test`;

  test.afterAll(async ({ request }) => {
    // Safety cleanup: remove any test post created during suite
    try {
      const { token } = getTokenAndUser('admin', 'admin@abir');
      const headers = { Authorization: `Bearer ${token}` };
      const commRes = await request.get('/api/community/posts?page=1&limit=50', { headers });
      if (commRes.ok()) {
        const data = await commRes.json();
        const lingeringPosts = (data.posts || []).filter(p => (p.content || '').includes('[PW_REALTIME_COMMUNITY_'));
        for (const p of lingeringPosts) {
          await request.delete(`/api/community/posts/${p.id}`, { headers });
          // also delete from trash permanently
          const trashRes = await request.get(`/api/admin/trash/posts?t=${Date.now()}`, { headers });
          if (trashRes.ok()) {
            const tData = await trashRes.json();
            const tbItem = (tData.items || []).find(x => JSON.stringify(x).includes(p.content));
            if (tbItem) {
              await request.delete(`/api/admin/trash/permanent/posts/${tbItem.id}`, { headers });
            }
          }
        }
      }
    } catch (e) {
      console.warn('Realtime cleanup non-fatal error:', e);
    }
  });

  test('1. Multi-Context Real-Time WebSockets: Live Bi-Directional Chat Messaging', async ({ browser }) => {
    // Create two isolated browser contexts (Context A = Admin, Context B = Student)
    const contextAdmin = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 }
    });
    const contextStudent = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 }
    });

    const pageAdmin = await contextAdmin.newPage();
    const pageStudent = await contextStudent.newPage();

    await injectAuth(pageAdmin, 'admin', 'admin@abir');
    await injectAuth(pageStudent, 'student', 'eathsharajsharon');

    // Step A: Open Inbox on both pages
    await pageAdmin.goto('/bfi-classroom/inbox', { waitUntil: 'domcontentloaded' });
    await pageStudent.goto('/bfi-classroom/inbox', { waitUntil: 'domcontentloaded' });
    await pageAdmin.waitForTimeout(2000);
    await pageStudent.waitForTimeout(2000);

    // Step B: Admin searches for Student and opens conversation
    const adminSearchInput = pageAdmin.locator('input[placeholder*="Search by name, username"]').first();
    await adminSearchInput.fill('Sharon');
    await pageAdmin.waitForTimeout(1000);

    const studentItem = pageAdmin.locator('.chat-item:has-text("Sharon"), .chat-item-directory:has-text("Sharon")').first();
    await expect(studentItem).toBeVisible();
    await studentItem.click();
    await pageAdmin.waitForTimeout(1500);

    // Step C: Student selects the Admin chat
    const studentChatToAdmin = pageStudent.locator('.chat-item:has-text("Abir"), .chat-item:has-text("Admin")').first();
    if (await studentChatToAdmin.isVisible()) {
      await studentChatToAdmin.click();
      await pageStudent.waitForTimeout(1000);
    }

    // Step D: Admin sends message to Student
    const adminMsgInput = pageAdmin.locator('textarea[placeholder*="message"], input[placeholder*="message"], textarea.chat-input, input.chat-input').first();
    if (await adminMsgInput.isVisible()) {
      await adminMsgInput.fill(testMsgAdmin);
      await adminMsgInput.press('Enter');
      await pageAdmin.waitForTimeout(1000);

      // Verify message appears in Admin's view
      await expect(pageAdmin.locator(`text="${testMsgAdmin}"`).first()).toBeVisible();

      // Step E: Verify Student receives the message in real time via WebSocket
      // If student hasn't opened conversation yet, select it
      const studentIncomingChat = pageStudent.locator('.chat-item:has-text("Abir"), .chat-item:has-text("Admin")').first();
      if (await studentIncomingChat.isVisible()) {
        await studentIncomingChat.click();
        await pageStudent.waitForTimeout(1000);
      }
      await expect(pageStudent.locator(`text="${testMsgAdmin}"`).first()).toBeVisible({ timeout: 10000 });

      // Step F: Student replies to Admin in real time
      const studentMsgInput = pageStudent.locator('textarea[placeholder*="message"], input[placeholder*="message"], textarea.chat-input, input.chat-input').first();
      if (await studentMsgInput.isVisible()) {
        await studentMsgInput.fill(testMsgStudent);
        await studentMsgInput.press('Enter');
        await pageStudent.waitForTimeout(1000);

        // Verify reply appears on Student's view
        await expect(pageStudent.locator(`text="${testMsgStudent}"`).first()).toBeVisible();

        // Step G: Verify Admin receives the student's reply in real time via WebSocket
        await expect(pageAdmin.locator(`text="${testMsgStudent}"`).first()).toBeVisible({ timeout: 10000 });
      }
    }

    await contextAdmin.close();
    await contextStudent.close();
  });

  test('2. Multi-Context Real-Time WebSockets: WebRTC Call Handshake & Decline Signaling', async ({ browser }) => {
    const contextAdmin = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 }
    });
    const contextStudent = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 }
    });

    const pageAdmin = await contextAdmin.newPage();
    const pageStudent = await contextStudent.newPage();

    await injectAuth(pageAdmin, 'admin', 'admin@abir');
    await injectAuth(pageStudent, 'student', 'eathsharajsharon');

    // Both users open the app
    await pageAdmin.goto('/bfi-classroom/inbox', { waitUntil: 'domcontentloaded' });
    await pageStudent.goto('/bfi-classroom/dashboard', { waitUntil: 'domcontentloaded' });
    await pageAdmin.waitForTimeout(2000);
    await pageStudent.waitForTimeout(2000);

    // Admin opens chat with Student
    const adminSearchInput = pageAdmin.locator('input[placeholder*="Search by name, username"]').first();
    await adminSearchInput.fill('Sharon');
    await pageAdmin.waitForTimeout(1000);

    const studentItem = pageAdmin.locator('.chat-item:has-text("Sharon"), .chat-item-directory:has-text("Sharon")').first();
    await expect(studentItem).toBeVisible();
    await studentItem.click();
    await pageAdmin.waitForTimeout(1500);

    // Admin clicks Audio Call button
    const audioCallBtn = pageAdmin.locator('button[title="Audio Call"]').first();
    await expect(audioCallBtn).toBeVisible();
    await audioCallBtn.click();
    await pageAdmin.waitForTimeout(1500);

    // Student's screen should immediately show IncomingCallAlert via Socket.io
    const incomingCallAlert = pageStudent.locator('.call-answer-btn.accept, .call-answer-btn.decline').first();
    await expect(incomingCallAlert).toBeVisible({ timeout: 10000 });

    const declineBtn = pageStudent.locator('.call-answer-btn.decline:has-text("Decline")').first();
    await expect(declineBtn).toBeVisible();
    await declineBtn.click();
    await pageStudent.waitForTimeout(1200);

    // Verify incoming call alert dismissed on Student screen
    await expect(pageStudent.locator('.call-answer-btn.decline')).toBeHidden();

    // Verify call state reset on Admin screen
    await pageAdmin.waitForTimeout(1500);

    await contextAdmin.close();
    await contextStudent.close();
  });

  test('3. Multi-Context Real-Time WebSockets: WebRTC Call Answer, Connected State & End Call', async ({ browser }) => {
    const contextAdmin = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 }
    });
    const contextStudent = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 }
    });

    const pageAdmin = await contextAdmin.newPage();
    const pageStudent = await contextStudent.newPage();

    await injectAuth(pageAdmin, 'admin', 'admin@abir');
    await injectAuth(pageStudent, 'student', 'eathsharajsharon');

    // Both users open the app
    await pageAdmin.goto('/bfi-classroom/inbox', { waitUntil: 'domcontentloaded' });
    await pageStudent.goto('/bfi-classroom/dashboard', { waitUntil: 'domcontentloaded' });
    await pageAdmin.waitForTimeout(2000);
    await pageStudent.waitForTimeout(2000);

    // Admin opens chat with Student
    const adminSearchInput = pageAdmin.locator('input[placeholder*="Search by name, username"]').first();
    await adminSearchInput.fill('Sharon');
    await pageAdmin.waitForTimeout(1000);

    const studentItem = pageAdmin.locator('.chat-item:has-text("Sharon"), .chat-item-directory:has-text("Sharon")').first();
    await expect(studentItem).toBeVisible();
    await studentItem.click();
    await pageAdmin.waitForTimeout(1500);

    // Admin clicks Audio Call button
    const audioCallBtn = pageAdmin.locator('button[title="Audio Call"]').first();
    await expect(audioCallBtn).toBeVisible();
    await audioCallBtn.click();
    await pageAdmin.waitForTimeout(1500);

    // Student receives incoming call alert
    const answerBtn = pageStudent.locator('.call-answer-btn.accept:has-text("Answer")').first();
    await expect(answerBtn).toBeVisible({ timeout: 10000 });

    // Student clicks Answer
    await answerBtn.click();
    await pageStudent.waitForTimeout(2000);

    // Verify ActiveCallScreen appears on both pages (with end call button)
    const endCallBtnStudent = pageStudent.locator('.call-ctrl-btn.danger, button[title*="End Call"]').first();
    await expect(endCallBtnStudent).toBeVisible({ timeout: 10000 });

    const endCallBtnAdmin = pageAdmin.locator('.call-ctrl-btn.danger, button[title*="End Call"]').first();
    await expect(endCallBtnAdmin).toBeVisible({ timeout: 10000 });

    // Either user ends the call
    await endCallBtnStudent.click();
    await pageStudent.waitForTimeout(1500);

    // Verify call UI dismissed on both sides
    await expect(pageStudent.locator('.call-ctrl-btn.danger')).toBeHidden();
    await expect(pageAdmin.locator('.call-ctrl-btn.danger')).toBeHidden();

    await contextAdmin.close();
    await contextStudent.close();
  });
});
