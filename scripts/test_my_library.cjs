const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { expect } = require('@playwright/test');
const browsers = require('playwright');

const dist = path.resolve(__dirname, '../dist');
const browserNames = process.argv[2]?.split(',') ?? ['chromium'];
const appBase = '/bfi-classroom';
const secret = 'test-jwt-for-library-in-isolated-fixtures';

test('My Library preserves personal bookmarks and course access', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bfi-library-'));
  process.env.DATABASE_PATH = path.join(directory, 'library.sqlite');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;

  const { default: db, initializeDatabase } = await import('../server/db/database.js');
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  initializeDatabase();

  // Simulate an existing database that has not yet run the new production migration.
  db.exec(`
    DROP TABLE course_material_bookmarks;
    DELETE FROM app_migrations WHERE name = '20261115_course_material_bookmarks'
  `);
  const migration = spawnSync(process.execPath, [
    path.resolve(__dirname, 'run_migrations.cjs'), process.env.DATABASE_PATH
  ], { encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  db.exec(`
    INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, is_active)
    VALUES (701, 'library-student-a', 'library-a@example.test', 'fixture', 'student', 'Library', 'A', 1),
           (702, 'library-student-b', 'library-b@example.test', 'fixture', 'student', 'Library', 'B', 1),
           (703, 'library-teacher', 'library-teacher@example.test', 'fixture', 'instructor', 'Library', 'Teacher', 1);
    INSERT INTO course_definitions (id, slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
    VALUES (111, 'library-fixture', 1, 'Library Workshop', 'workshop', 'published', 1, '{}', 703, 703);
    INSERT INTO batches (id, batch_name, batch_number, course_name, course_definition_id)
    VALUES (801, 'First Batch', '01', 'Library Workshop', 111),
           (802, 'Second Batch', '02', 'Library Workshop', 111);
    INSERT INTO batch_students (batch_id, student_id) VALUES (801, 701), (801, 702);
    INSERT INTO student_course_enrollments (user_id, course_name)
    VALUES (701, 'Legacy Course');
    INSERT INTO course_materials (id, title, file_type, file_url, batch_id, batch_number, course_name, uploaded_by)
    VALUES (901, 'Story Notes', 'pdf', '/media/course-materials/story.pdf', 801, '01', 'Library Workshop', 703),
           (902, 'Editing Video', 'video', 'https://example.test/edit', 801, '01', 'Library Workshop', 703),
           (903, 'Shot List Link', 'link', 'https://example.test/shot-list', 801, '01', 'Library Workshop', 703),
           (904, 'Other Batch Notes', 'pdf', '/media/course-materials/private.pdf', 802, '02', 'Library Workshop', 703),
           (905, 'Legacy Notes', 'pdf', '/media/course-materials/legacy.pdf', NULL, 'All', 'Legacy Course', 703);
    INSERT INTO student_profiles (user_id, full_name, batch_number) VALUES (701, 'Library A', 'Legacy Batch');
  `);

  const { default: courseRouter } = await import('../server/routes/course.js');
  const { default: authRouter } = await import('../server/routes/auth.js');
  const app = express();
  app.use(express.json());
  app.use(['/api/auth', appBase + '/api/auth'], authRouter);
  app.use(['/api/courses', appBase + '/api/courses'], courseRouter);
  app.get('/api/notifications/unread-count', (_req, res) => res.json({ count: 0 }));
  app.get('/api/inbox/conversations', (_req, res) => res.json([]));
  app.use(appBase, express.static(dist, { redirect: false }));
  app.get(appBase + '/:page', (_req, res) => res.sendFile('index.html', { root: dist }));

  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const token = id => jwt.sign({ id, token_version: 1, type: 'access' }, secret, { expiresIn: '15m' });
  const list = id => fetch(origin + '/api/courses/bookmarks', {
    headers: id ? { Authorization: 'Bearer ' + token(id) } : {}
  });
  const setBookmark = (id, material, bookmarked) => fetch(origin + '/api/courses/bookmarks/' + material, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token(id), 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmarked })
  });

  await t.test('real API authorizes both Course Maker and legacy material and ignores inaccessible items', async () => {
    assert.equal((await list()).status, 401);
    assert.equal((await list(703)).status, 403);
    assert.equal((await setBookmark(703, 901, true)).status, 403);
    assert.equal((await setBookmark(701, 904, true)).status, 404);
    assert.equal((await setBookmark(701, '901oops', true)).status, 400);
    assert.equal((await setBookmark(701, 901, 'true')).status, 400);
    const first = await setBookmark(701, 905, true);
    const duplicate = await setBookmark(701, 905, true);
    assert.equal(first.status, 200);
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await first.json(), await duplicate.json());
    const saved = await list(701);
    assert.match(saved.headers.get('cache-control'), /no-store/);
    assert.deepEqual((await saved.json()).materials.map(item => item.id), [905]);
    assert.deepEqual((await (await list(702)).json()).materials, []);

    db.prepare('UPDATE course_materials SET deleted_at = datetime(\'now\') WHERE id = 905').run();
    assert.deepEqual((await (await list(701)).json()).materials, []);
    assert.equal((await setBookmark(701, 905, false)).status, 200);
    assert.equal((await setBookmark(701, 905, false)).status, 200);

    assert.equal((await setBookmark(701, 901, true)).status, 200);
    db.prepare('DELETE FROM batch_students WHERE batch_id = 801 AND student_id = 701').run();
    assert.deepEqual((await (await list(701)).json()).materials, []);
    assert.equal((await setBookmark(701, 901, true)).status, 404);
    assert.equal((await setBookmark(701, 901, false)).status, 200);
    db.prepare('INSERT INTO batch_students (batch_id, student_id) VALUES (801, 701)').run();
  });

  for (const name of browserNames) {
    await t.test(name + ' student saves, filters, reloads and removes real course materials', async () => {
      db.prepare('DELETE FROM course_material_bookmarks WHERE user_id IN (701, 702)').run();
      const browser = await browsers[name].launch();
      try {
        async function signedInPage(id, viewport) {
          const context = await browser.newContext({ viewport });
          await context.route('**/*', route => route.request().url().startsWith(origin + '/')
            ? route.continue() : route.abort());
          await context.addInitScript(accessToken => localStorage.setItem('token', accessToken), token(id));
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          return page;
        }

        const page = await signedInPage(701, { width: 390, height: 844 });
        await page.goto(origin + appBase + '/courses');
        await page.locator('.resource-library').waitFor();
        await expect(page.getByRole('heading', { name: 'Course Materials', exact: true })).toBeVisible();
        for (const title of ['Story Notes', 'Editing Video', 'Shot List Link']) {
          const button = page.getByRole('button', { name: 'Bookmark ' + title });
          await expect(button).toHaveAttribute('aria-pressed', 'false');
          await button.click();
          await expect(button).toHaveAttribute('aria-pressed', 'true');
        }
        await page.getByRole('link', { name: 'My Library', exact: true }).and(page.locator('.resource-library a')).click();
        await expect(page.getByRole('heading', { name: 'My Library', exact: true })).toBeVisible();
        await expect(page.locator('.resource-library__row')).toHaveCount(3);
        await expect(page.getByRole('link', { name: /Watch Editing Video/ })).toHaveAttribute('href', 'https://example.test/edit');
        await expect(page.getByRole('link', { name: /Open Story Notes/ })).toHaveAttribute('href', origin + '/media/course-materials/story.pdf');
        await expect(page.getByRole('link', { name: /Open Shot List Link/ })).toHaveAttribute('href', 'https://example.test/shot-list');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.getByLabel('Resource type').selectOption('PDFs');
        await expect(page.locator('.resource-library__row')).toHaveCount(1);
        await page.getByLabel('Search materials').fill('Library Workshop');
        await expect(page.getByRole('heading', { name: 'Story Notes' })).toBeVisible();
        await page.getByLabel('Search materials').fill('unmatched title');
        await expect(page.getByText('No materials match your filters.')).toBeVisible();
        await page.reload();
        await expect(page.locator('.resource-library__row')).toHaveCount(3);
        await page.getByRole('button', { name: 'Bookmark Story Notes' }).click();
        await expect(page.locator('.resource-library__row')).toHaveCount(2);
        await page.reload();
        await expect(page.locator('.resource-library__row')).toHaveCount(2);
        await expect(page.getByRole('heading', { name: 'Story Notes' })).toHaveCount(0);

        const other = await signedInPage(702, { width: 1280, height: 800 });
        await other.goto(origin + appBase + '/my-library');
        await expect(other.getByText(/Your library is empty/)).toBeVisible();
        await page.getByRole('button', { name: 'Bookmark Editing Video' }).click();
        await expect(page.locator('.resource-library__row')).toHaveCount(1);
        await page.getByRole('button', { name: 'Bookmark Shot List Link' }).click();
        await expect(page.getByText(/Your library is empty/)).toBeVisible();
      } finally {
        await browser.close();
      }
    });
  }
});
