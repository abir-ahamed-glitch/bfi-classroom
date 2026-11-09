// Real compiled Student Portal and student routes, using a disposable database only.
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const os = require('os');
const express = require('express');
const jwt = require('jsonwebtoken');
const playwright = require('playwright');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bfi-student-journey-'));
process.env.DATABASE_PATH = path.join(directory, 'journey.sqlite');
process.env.JWT_SECRET = 'isolated-journey-browser-test-secret';
process.env.NODE_ENV = 'test';
let db, server, browser;

async function run() {
  const database = await import('../server/db/database.js');
  db = database.default;
  await database.initializeDatabase();
  const insert = db.prepare(`INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, token_version)
    VALUES (?, ?, 'not-a-login-password', 'student', 'Journey', 'Student', 1, 1)`);
  const userId = Number(insert.run('journey_student', 'journey@example.test').lastInsertRowid);
  db.prepare(`INSERT INTO student_profiles (user_id, student_id, full_name) VALUES (?, 'JOURNEY-TEST', 'Journey Student')`).run(userId);
  const enrollmentId = Number(db.prepare(`INSERT INTO student_course_enrollments
    (user_id, course_name, course_type, step1_completed, step2_completed, created_at)
    VALUES (?, 'Timeline Workshop', 'workshop', 1, 1, '2026-01-02 13:00:00')`).run(userId).lastInsertRowid);
  const app = express();
  app.use(express.json());
  app.use('/api/student', (await import('../server/routes/student.js')).default);
  app.use('/api/auth', (await import('../server/routes/auth.js')).default);
  const dist = path.resolve(__dirname, '../dist');
  app.use('/bfi-classroom', express.static(dist, { dotfiles: 'allow' }));
  app.get('/bfi-classroom/{*path}', (_req, res) => res.sendFile('index.html', { root: dist, dotfiles: 'allow' }));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const engine = process.env.JOURNEY_BROWSER || 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('Unknown browser engine');
  browser = await playwright[engine].launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('Browser error:', error.message));
  page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400) console.log('API response:', response.status(), new URL(response.url()).pathname); });
  page.on('requestfailed', request => console.log('Request failed:', new URL(request.url()).pathname, request.failure()?.errorText));
  const user = { id: userId, username: 'journey_student', role: 'student', first_name: 'Journey', last_name: 'Student' };
  const token = jwt.sign({ ...user, type: 'access', token_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('auth_user_cache', JSON.stringify(user));
  }, { token, user });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseUrl}/bfi-classroom/student-portal`);
    const journey = page.locator('.student-journey');
    await journey.getByRole('heading', { name: 'Timeline Workshop' }).waitFor({ timeout: 10000 }).catch(async error => { console.error('Page:', page.url(), await page.locator('body').innerText()); throw error; });
    assert.equal(await journey.getByText('Enrolled', { exact: true }).count(), 1);
    assert.match(await journey.locator('time').innerText(), /2 Jan 2026.*07:00 pm BST/i);
    assert.equal(await journey.getByText('Achievements without recorded dates').count(), 1);
    assert.equal(await journey.getByText('Phase 1 passed', { exact: true }).count(), 1);
    assert.equal(await journey.getByText('Certificate downloaded', { exact: true }).count(), 0);
    assert.equal(await journey.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    assert.equal(await journey.getByRole('link', { name: 'View my certificates' }).getAttribute('href'), '/bfi-classroom/certificates');
    fs.mkdirSync(path.resolve(__dirname, '../test-results/student-journey'), { recursive: true });
    await journey.screenshot({ path: path.resolve(__dirname, `../test-results/student-journey/${viewport.width}.png`) });
    console.log(`PASS: real Student Portal, ${viewport.width}px, Bangladesh dates, undated achievements, certificate link, no timeline overflow`);
  }
  const definition = {
    basics: { name: 'Film Journey', type: 'course', phaseCount: 2 },
    completionPolicy: { certificateEligibility: { allRequiredPhasesPassed: true }, phaseProgression: { sequentialProgression: true, requirePreviousPhasePassed: true } },
    phases: [
      { id: 'phase_1', phaseIndex: 1, title: 'Foundation', classes: [{ id: 'class_a', title: 'Camera', mandatory: true }], assignments: [{ id: 'film_a', title: 'Short film', passMarks: 10, maxMarks: 20 }], exam: { enabled: true, passMarks: 40, maxMarks: 80 } },
      { id: 'phase_2', phaseIndex: 2, title: 'Production', classes: [], assignments: [], exam: { enabled: false } }
    ]
  };
  const definitionId = db.prepare(`INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
    VALUES ('journey-film', 1, 'Film Journey', 'course', 'published', 2, ?, 1, 1)`).run(JSON.stringify(definition)).lastInsertRowid;
  const definedEnrollment = db.prepare(`INSERT INTO student_course_enrollments (user_id, course_name, course_type, course_definition_id, course_version)
    VALUES (?, 'Film Journey', 'course', ?, 1)`).run(userId, definitionId).lastInsertRowid;
  await page.reload();
  const film = page.locator('.student-journey article').filter({ has: page.getByRole('heading', { name: 'Film Journey' }) });
  await film.getByText('Phase 1 · Foundation · Pass exam').waitFor();
  assert.equal(await film.getByText('Phase 1 · Foundation · Exam passed', { exact: true }).count(), 0);
  const progress = await import('../server/services/courseProgressService.js');
  await progress.updateDefinedProgressAtomic(definedEnrollment, { attendance: [{ class_id: 'class_a', attended: 1 }], assignments: [{ assignment_id: 'film_a', marks: 18, submission_status: 'graded' }], exam_marks: [{ phase_id: 'phase_1', examMarks: 70 }], updatedBy: 1 }, db);
  await page.reload();
  await film.getByText('Phase 1 · Foundation · Exam passed', { exact: true }).waitFor();
  assert.equal(await film.getByText('Short film submitted', { exact: true }).count(), 1);
  assert.equal(await film.getByText('Phase 1 · Foundation · Pass exam', { exact: true }).count(), 0);
  console.log(`PASS: ${engine} Course Maker multi-phase progression and film assignment update in real Student Portal`);
  await page.route('**/api/student/journey', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Journey temporarily unavailable' }) }));
  await page.reload();
  await page.locator('.student-journey').getByRole('alert').waitFor();
  await page.unroute('**/api/student/journey');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('.student-journey').getByRole('heading', { name: 'Timeline Workshop' }).waitFor();
  console.log('PASS: error displayed and retry recovers through real endpoint');
  db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(enrollmentId);
  db.prepare('DELETE FROM student_class_attendance WHERE enrollment_id = ?').run(definedEnrollment);
  db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id = ?').run(definedEnrollment);
  db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(definedEnrollment);
  db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(definedEnrollment);
  await page.reload();
  await page.getByText('Your journey will appear here when you enroll in a course.').waitFor();
  console.log('PASS: unenrolled student sees accurate empty state');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (db) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
