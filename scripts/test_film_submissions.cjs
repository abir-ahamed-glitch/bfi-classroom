// Real compiled Student Portal and student routes, using a disposable database only.
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('os');
const express = require('express');
const jwt = require('jsonwebtoken');
const playwright = require('playwright');
const { Server } = require('socket.io');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bfi-film-submission-'));
process.env.DATABASE_PATH = path.join(directory, 'journey.sqlite');
process.env.JWT_SECRET = 'isolated-journey-browser-test-secret';
process.env.NODE_ENV = 'test';
let db, server, browser, sockets;

async function run() {
  const database = await import('../server/db/database.js');
  db = database.default;
  await database.initializeDatabase();
  const userId = Number(db.prepare("INSERT INTO users (username,email,password_hash,role,first_name,last_name,is_active,token_version) VALUES ('film_student','film@example.test','hash','student','Film','Student',1,1)").run().lastInsertRowid);
  db.prepare("INSERT INTO student_profiles (user_id,student_id,full_name) VALUES (?, 'FILM-TEST', 'Film Student')").run(userId);
  const enrollmentId = Number(db.prepare("INSERT INTO student_course_enrollments (user_id,course_name,step3_completed) VALUES (?, 'Online Filmmaking Course',1)").run(userId).lastInsertRowid);
  db.prepare("UPDATE users SET is_super_admin=1 WHERE id=1").run();
  const session = db.prepare("INSERT INTO sessions (user_id,token_hash,expires_at) VALUES (1,'test',datetime('now','+1 day'))").run().lastInsertRowid;
  const adminToken = jwt.sign({id:1,role:'admin',type:'access',sessionId:Number(session),token_version:1},process.env.JWT_SECRET,{expiresIn:'1h'});
  const token = jwt.sign({id:userId,role:'student',type:'access',token_version:1},process.env.JWT_SECRET,{expiresIn:'1h'});
  const app = express(); app.use(express.json());
  app.use('/api/notifications',(await import('../server/routes/notifications.js')).default);
  app.use('/api/community',(await import('../server/routes/community.js')).default);
  app.use('/api/courses',(await import('../server/routes/course.js')).default);
  app.use('/api/inbox',(await import('../server/routes/inbox.js')).default);
  app.use('/api/student',(await import('../server/routes/student.js')).default);
  app.use('/api/auth',(await import('../server/routes/auth.js')).default);
  app.use('/api/film-submissions',(await import('../server/routes/film-submissions.js')).default);
  app.use('/api/assessment-windows',(await import('../server/routes/assessment-windows.js')).default);
  app.use('/api/assessment-submissions',(await import('../server/routes/assessment-submissions.js')).default);
  app.use('/api/zoom-meetings',(await import('../server/routes/zoom-meetings.js')).default);
  app.use('/api/admin',(await import('../server/routes/admin.js')).default);
  app.use('/api/admin/batches',(await import('../server/routes/batches.js')).default);
  app.use('/api/admin/course-definitions',(await import('../server/routes/course-definitions.js')).default);
  app.use('/api/certification',(await import('../server/routes/certification.js')).default);
  const dist=path.resolve(__dirname,'../dist');
  app.use('/bfi-classroom/zoom-embed/assets', (_req,res,next) => {res.set('Access-Control-Allow-Origin','*'); next();});
  app.use('/bfi-classroom',express.static(dist,{dotfiles:'allow'}));
  app.get('/bfi-classroom/{*path}',(_req,res)=>res.sendFile('index.html',{root:dist,dotfiles:'allow'}));
  server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  sockets = new Server(server);
  sockets.use((socket, next) => {
    try {
      socket.data.userId = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET).id;
      next();
    } catch (error) { next(error); }
  });
  sockets.on('connection', socket => socket.join('user:' + socket.data.userId));
  app.set('io', sockets);

  async function request(url,method='GET',body,auth=token){
    const response=await fetch(baseUrl+url,{method,headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  }
  const payload={enrollmentId,phaseId:'phase_2',title:'My short film',videoUrl:'https://youtu.be/abcdefghijk',notes:'Unlisted film for review'};
  const outsider = Number(db.prepare("INSERT INTO users (username,email,password_hash,role,first_name,last_name,is_active,token_version) VALUES ('outsider','outsider@example.test','hash','student','Other','Student',1,1)").run().lastInsertRowid);
  const outsiderToken = jwt.sign({id:outsider,role:'student',type:'access',token_version:1},process.env.JWT_SECRET,{expiresIn:'1h'});
  assert.equal((await request('/api/film-submissions','POST',payload,outsiderToken)).status,404);
  assert.equal((await request('/api/film-submissions?userId='+userId,'GET',undefined,outsiderToken)).data.courses.length,0);
  assert.equal((await request('/api/film-submissions','POST',{...payload,videoUrl:'https://youtube.com.evil.test/watch?v=abcdefghijk'})).status,400);
  assert.equal((await request('/api/film-submissions','POST',{...payload,videoUrl:'javascript:alert(1)'})).status,400);
  assert.equal((await request('/api/film-submissions','POST',{...payload,enrollmentId:999999})).status,404);
  db.prepare('UPDATE student_course_enrollments SET step3_completed=0 WHERE id=?').run(enrollmentId);
  assert.equal((await request('/api/film-submissions','POST',payload)).status,403);
  db.prepare('UPDATE student_course_enrollments SET step3_completed=1 WHERE id=?').run(enrollmentId);
  const initial=await request('/api/film-submissions','POST',payload); assert.equal(initial.status,201);
  db.exec("DROP TABLE film_feedback_notes; DELETE FROM app_migrations WHERE name = '20261115_film_feedback'");
  const feedbackMigration = spawnSync(process.execPath, [path.resolve(__dirname, 'run_migrations.cjs'), process.env.DATABASE_PATH], { encoding: 'utf8' });
  assert.equal(feedbackMigration.status, 0, feedbackMigration.stderr || feedbackMigration.stdout);
  assert.equal(db.prepare('SELECT title FROM film_submissions WHERE id = ?').get(initial.data.id).title, payload.title);
  assert.equal((await request('/api/film-submissions','POST',payload)).status,409);
  assert.equal((await request(`/api/film-submissions/${initial.data.id}/review`,'PATCH',{status:'accepted'})).status,403);
  assert.equal((await request(`/api/film-submissions/${initial.data.id}/review`,'PATCH',{status:'changes_requested'},adminToken)).status,400);
  const reviewUrl=`/api/film-submissions/${initial.data.id}/review`;
  const createTeacher = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active, token_version)
    VALUES (?, ?, 'fixture', 'instructor', 'Film', 'Mentor', 1, 1)
  `);
  const assigned = Number(createTeacher.run('film_mentor', 'film-mentor@example.test').lastInsertRowid);
  const otherTeacher = Number(createTeacher.run('other_mentor', 'other-mentor@example.test').lastInsertRowid);
  const teacherToken = id => jwt.sign({ id, role: 'instructor', type: 'access', token_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const instructorToken = teacherToken(assigned);
  const otherTeacherToken = teacherToken(otherTeacher);
  const createBatch = db.prepare("INSERT INTO batches (batch_name, batch_number, course_name) VALUES (?, ?, 'Online Filmmaking Course')");
  const feedbackBatchId = Number(createBatch.run('Film Feedback Batch', 'F18').lastInsertRowid);
  const otherBatchId = Number(createBatch.run('Other Film Feedback Batch', 'F19').lastInsertRowid);
  db.prepare('UPDATE student_course_enrollments SET batch_id = ? WHERE id = ?').run(feedbackBatchId, enrollmentId);
  db.prepare('INSERT INTO batch_instructors (batch_id, user_id) VALUES (?, ?), (?, ?)').run(feedbackBatchId, assigned, otherBatchId, otherTeacher);
  const notePath = `/api/film-submissions/${initial.data.id}/feedback`;
  const goodNote = { videoSeconds: 134, note: 'Trim the pause before the cut.' };
  assert.equal((await request(notePath, 'POST', goodNote, token)).status, 403);
  assert.equal((await request(notePath, 'POST', goodNote, otherTeacherToken)).status, 404);
  assert.equal((await request('/api/film-submissions?batch_id=' + feedbackBatchId, 'GET', undefined, otherTeacherToken)).status, 404);
  assert.deepEqual((await request('/api/film-submissions', 'GET', undefined, otherTeacherToken)).data.courses, []);
  assert.equal((await request(reviewUrl, 'PATCH', { status: 'accepted' }, instructorToken)).status, 403);
  for (const invalid of [{videoSeconds: -1}, {videoSeconds: 1.5}, {videoSeconds: '134'}, {videoSeconds: 360000}, {note: '   '}, {note: 'x'.repeat(2001)}]) {
    assert.equal((await request(notePath, 'POST', {...goodNote, ...invalid}, instructorToken)).status, 400);
  }
  assert.equal((await request(notePath, 'POST', goodNote, instructorToken)).status, 201);
  const firstFrame = await request(notePath, 'POST', { videoSeconds: 0, note: 'The wide shot establishes the location.' }, instructorToken);
  assert.equal(firstFrame.status, 201);
  assert.equal(firstFrame.data.author_name, 'Film Mentor');
  const ownerNotes = (await request('/api/film-submissions')).data.courses.find(course => course.enrollmentId === enrollmentId).submissions[0];
  assert.equal(ownerNotes.status, 'under_review');
  assert.deepEqual(ownerNotes.timestamped_feedback.map(note => note.video_seconds), [0, 134]);
  assert.deepEqual((await request('/api/film-submissions', 'GET', undefined, outsiderToken)).data.courses, []);
  db.prepare('DELETE FROM batch_instructors WHERE batch_id = ? AND user_id = ?').run(feedbackBatchId, assigned);
  assert.equal((await request(notePath, 'POST', goodNote, instructorToken)).status, 404);
  db.prepare('INSERT INTO batch_instructors (batch_id, user_id) VALUES (?, ?)').run(feedbackBatchId, assigned);
  console.log('PASS: timestamp notes preserve status, validate input, scope by exact instructor batch and student account, and follow access revocation');
  db.exec("CREATE TRIGGER reject_film_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='academic.film_review' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.equal((await request(reviewUrl,'PATCH',{status:'accepted'},adminToken)).status,500);
  assert.equal(db.prepare('SELECT status FROM film_submissions WHERE id=?').get(initial.data.id).status,'under_review');
  db.exec('DROP TRIGGER reject_film_audit');
  assert.equal((await request(reviewUrl,'PATCH',{status:'changes_requested',feedback:'Please improve sound.'},adminToken)).status,200);
  assert.equal((await request(reviewUrl,'PATCH',{status:'accepted'},adminToken)).status,409);
  const revision=await request('/api/film-submissions','POST',{...payload,title:'My revised film'}); assert.equal(revision.status,201); assert.equal(revision.data.revision,2);
  console.log('PASS: real routes reject invalid links, missing enrollment, locked phase, duplicate submission, unauthorized review, stale review; audit failure rolls review back; revision history preserved');
  const engine=process.env.JOURNEY_BROWSER||'chromium'; browser=await playwright[engine].launch({headless:true});
  const studentPage=await browser.newPage({viewport:{width:390,height:844}});
  if (process.env.TEST_ZOOM_REAL_BUNDLE === 'true') studentPage.on('console', message => {if (message.type() === 'error') console.error('BROWSER ERROR:', message.text());});
  if (process.env.TEST_ZOOM_REAL_BUNDLE === 'true') studentPage.on('pageerror', error => console.error('BROWSER EXCEPTION:', error.message));
  await studentPage.addInitScript(({token,userId})=>{localStorage.setItem('token',token);localStorage.setItem('auth_user_cache',JSON.stringify({id:userId,role:'student',username:'film_student'}));},{token,userId});
  await studentPage.goto(baseUrl+'/bfi-classroom/film-submissions');
  await studentPage.getByRole('heading',{name:/My revised film.*Version 2/}).waitFor();
  assert.equal(await studentPage.getByText('Under Review',{exact:true}).count(),1);
  assert.equal(await studentPage.getByText('Please improve sound.',{exact:false}).count(),1);
  const instructorPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await instructorPage.addInitScript(accessToken => localStorage.setItem('token', accessToken), instructorToken);
  await instructorPage.goto(baseUrl + '/bfi-classroom/film-submissions');
  await instructorPage.getByRole('heading', { name: 'Film Review', exact: true }).waitFor();
  assert.equal(await instructorPage.getByRole('link', { name: 'Film Review', exact: true }).count(), 1);
  const instructorRevision = instructorPage.locator('.film-submission', { hasText: 'My revised film' });
  await instructorRevision.getByLabel('Video time').fill('2:99');
  await instructorRevision.getByLabel('Feedback note').fill('Hold on this reaction shot.');
  await instructorRevision.getByRole('button', { name: 'Post feedback' }).click();
  await instructorRevision.getByRole('alert').getByText(/Enter a video time/).waitFor();
  await instructorRevision.getByLabel('Video time').fill('0:37');
  await instructorRevision.getByRole('button', { name: 'Post feedback' }).click();
  await instructorRevision.getByText('Feedback posted.').waitFor();
  assert.equal(await instructorPage.getByRole('button', { name: 'Save review' }).count(), 0);
  await instructorPage.close();
  await studentPage.reload();
  const studentRevision = studentPage.locator('.film-submission', { hasText: 'My revised film' });
  await studentRevision.getByText('Hold on this reaction shot.').waitFor();
  assert.equal(await studentRevision.getByRole('link', { name: /Watch at 0:37/ }).getAttribute('href'), 'https://www.youtube.com/watch?v=abcdefghijk&t=37s');
  assert.equal(await studentRevision.getByText('Trim the pause before the cut.').count(), 0);
  await studentPage.locator('.film-submission', { hasText: 'Version 1' }).getByText('Trim the pause before the cut.').waitFor();
  assert.equal(await studentPage.getByRole('button', { name: 'Post feedback' }).count(), 0);
  console.log('PASS: instructor portal posts timestamp feedback and student sees it on the correct version after reload');
  const adminPage=await browser.newPage();
  await adminPage.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('auth_user_cache',JSON.stringify({id:1,role:'admin'}));},adminToken);
  await adminPage.goto(baseUrl+'/bfi-classroom/film-submissions');
  await adminPage.getByLabel('Review outcome').selectOption('accepted');
  await adminPage.getByLabel('Feedback (required when requesting changes)').fill('Accepted for screening.');
  await adminPage.getByRole('button',{name:'Save review',exact:true}).click();
  await adminPage.getByText('Accepted',{exact:true}).waitFor();
  await studentPage.reload(); await studentPage.getByText('Accepted',{exact:true}).waitFor();
  assert.equal(await studentPage.getByRole('button',{name:'Submit film for review'}).count(),0);
  const journey=await request('/api/student/journey');
  assert.ok(journey.data.courses.find(c=>c.enrollmentId===enrollmentId).events.some(e=>e.type==='film_accepted'));
  assert.equal(db.prepare('SELECT step4_completed FROM student_course_enrollments WHERE id=?').get(enrollmentId).step4_completed,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE action='academic.film_review'").get().n,2);
  const def={basics:{name:'Course Maker Film',phaseCount:2},phases:[{id:'foundation',phaseIndex:1,title:'Foundation',classes:[],assignments:[],exam:{enabled:false}},{id:'production',phaseIndex:2,title:'Production',classes:[],assignments:[],exam:{enabled:false}}]};
  const defId=db.prepare("INSERT INTO course_definitions (slug,name,course_type,status,phase_count,definition_json,created_by,updated_by) VALUES ('film-test','Course Maker Film','course','published',2,?,1,1)").run(JSON.stringify(def)).lastInsertRowid;
  const defined=db.prepare("INSERT INTO student_course_enrollments (user_id,course_name,course_definition_id,course_version) VALUES (?,'Course Maker Film',?,1)").run(userId,defId).lastInsertRowid;
  const before=await request('/api/film-submissions');
  assert.equal(before.data.courses.find(c=>c.enrollmentId===Number(defined)).phases.find(p=>p.id==='production').eligible,false);
  db.prepare("INSERT INTO student_phase_results (enrollment_id,phase_id,admitted,admitted_at) VALUES (?,'production',1,datetime('now'))").run(defined);
  const after=await request('/api/film-submissions');
  assert.equal(after.data.courses.find(c=>c.enrollmentId===Number(defined)).phases.find(p=>p.id==='production').eligible,true);
  const definedSubmit=await request('/api/film-submissions','POST',{...payload,enrollmentId:Number(defined),phaseId:'production'}); assert.equal(definedSubmit.status,201);
  const definedBatch = db.prepare(
    "INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id) VALUES ('Film Workshop', 'D1', 'Course Maker Film', ?)"
  ).run(defId).lastInsertRowid;
  db.prepare('UPDATE student_course_enrollments SET batch_id = ? WHERE id = ?').run(definedBatch, defined);
  def.phases[1].routine = [{ id: 'mentor-routine-slot', teacherUserId: assigned }];
  def.phases[1].assignments = [{id: 42, title: 'Photo assignment', submissionRequired: false, maxMarks: 20, passMarks: 0}];
  db.prepare('UPDATE course_definitions SET definition_json = ? WHERE id = ?').run(JSON.stringify(def), defId);
  const definedNotePath = '/api/film-submissions/' + definedSubmit.data.id + '/feedback';
  assert.equal((await request(definedNotePath, 'POST', { videoSeconds: 6, note: 'Course Maker mentor feedback.' }, instructorToken)).status, 201);
  assert.equal((await request(definedNotePath, 'POST', goodNote, otherTeacherToken)).status, 404);
  console.log('PASS: canonical feedback migration preserves existing films; Course Maker routine assignment grants feedback on its batch');
  await studentPage.reload();
  const foundation=studentPage.locator('.film-phase').filter({has:studentPage.getByRole('heading',{name:/Phase 1.*Foundation/})});
  await foundation.getByLabel('Film title').fill('Foundation exercise');
  await foundation.getByLabel('YouTube or Vimeo video link').fill('https://vimeo.com/123456789');
  await foundation.getByRole('button',{name:'Submit film for review'}).click();
  await foundation.getByRole('heading',{name:/Foundation exercise.*Version 1/}).waitFor();
  const foundationFilm = db.prepare("SELECT id FROM film_submissions WHERE enrollment_id = ? AND phase_id = 'foundation'").get(defined);
  assert.equal((await request('/api/film-submissions/' + foundationFilm.id + '/feedback', 'POST', { videoSeconds: 3723, note: 'Vimeo timestamp example.' }, adminToken)).status, 201);
  await studentPage.reload();
  const vimeoTimestamp = foundation.getByRole('link', { name: /Watch at 1:02:03/ });
  await vimeoTimestamp.waitFor();
  assert.equal(await vimeoTimestamp.getAttribute('href'), 'https://vimeo.com/123456789#t=62m3s');
  assert.equal(await foundation.getByText('Under Review',{exact:true}).count(),1);
  await studentPage.locator('.film-portal').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const layout = await studentPage.locator('.film-portal').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, overflowing: [...element.querySelectorAll('*')].filter(child=>child.getBoundingClientRect().right>element.getBoundingClientRect().right+1).map(child=>({tag:child.tagName,text:child.textContent.slice(0,60),width:child.getBoundingClientRect().width})) }));
  // WebKit on Windows reserves a vertical scrollbar inside this container.
  // Check visible content bounds and the actual viewport, rather than counting that gutter as content.
  assert.equal(layout.overflowing.length, 0, JSON.stringify(layout));
  assert.ok(await studentPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  fs.mkdirSync(path.resolve(__dirname,'../test-results/film-submissions'),{recursive:true});
  await studentPage.screenshot({path:path.resolve(__dirname,`../test-results/film-submissions/${engine}.png`),fullPage:true});
  const theoryClasses = Array.from({length: 5}, (_, index) => ({
    id: 'theory-' + index, title: 'Theory ' + index, category: 'theory', deliveryMode: 'live', platform: 'Zoom', mandatory: false
  }));
  const onlineClasses = theoryClasses.map((cls, index) => ({...cls, id: 'online-' + index}));
  const phases = [{
    id: 'theory', phaseIndex: 1, title: 'Theory', feeAmount: 0, classes: theoryClasses,
    requirements: {attendanceRequired: true, minAttendancePercent: 80, completionRequired: true, examAttendanceGate: true},
    exam: {enabled: true, type: 'written', title: 'Theory exam', maxMarks: 80, passMarks: 0, phasePassThreshold: 50},
    assignments: [{id: 'written-assignment', title: 'Written assignment', submissionRequired: true, maxMarks: 20, passMarks: 0}]
  }, {
    id: 'practical', phaseIndex: 2, title: 'Practical', feeAmount: 0,
    classes: [...onlineClasses,
      {id: 'shoot', title: 'Shoot', category: 'shooting', deliveryMode: 'offline'},
      {id: 'edit', title: 'Edit', category: 'editing', deliveryMode: 'offline'}],
    requirements: {attendanceRequired: true, minAttendancePercent: 100, completionRequired: true, filmWorkflow: true}
  }];
  const draft = await request('/api/admin/course-definitions', 'POST', {
    name: 'Ordered Filmmaking', course_type: 'filmmaking', phase_count: 2, phases
  }, adminToken);
  assert.equal(draft.status, 201, JSON.stringify(draft.data));
  const publish = await request('/api/admin/course-definitions/' + draft.data.id + '/publish', 'POST', {}, adminToken);
  assert.equal(publish.status, 200, JSON.stringify(publish.data));
  const orderedId = Number(db.prepare(`
    INSERT INTO student_course_enrollments (user_id,course_name,course_type,course_definition_id,course_version)
    VALUES (?,'Ordered Filmmaking','filmmaking',?,1)
  `).run(userId, draft.data.id).lastInsertRowid);
  const courseApi = '/api/admin/students/' + userId + '/courses/' + orderedId;
  const progressApi = courseApi + '/defined-progress';
  const save = body => request(progressApi, 'PUT', body, adminToken);
  const admit = () => request(courseApi + '/phases/2/admit', 'POST', {}, adminToken);
  const marks = {exam_marks: [{phase_id: 'theory', marks: 40}]};
  const present = ids => ({attendance: ids.map(class_id => ({class_id, attended: true}))});
  const submitFilm = () => request('/api/film-submissions', 'POST', {...payload, enrollmentId: orderedId, phaseId: 'practical'});
  const listCertificate = async () => (await request('/api/certification/my-certificates')).data.certificates.find(item => item.enrollmentId === orderedId);
  const download = () => request('/api/certification/log-download', 'POST', {enrollmentId: orderedId});
  assert.equal((await save(present(theoryClasses.slice(0, 3).map(cls => cls.id)))).status, 200);
  assert.equal((await save(marks)).status, 400);
  assert.equal((await submitFilm()).status, 403);
  assert.equal((await save(present(['theory-3']))).status, 200);
  assert.equal((await save(marks)).status, 200);
  assert.equal((await admit()).status, 400);
  const assignment = await save({assignments: [{assignment_id: 'written-assignment', marks: 10, submission_status: 'graded'}]});
  assert.equal(assignment.status, 200);
  assert.equal(assignment.data.progress.phases[0].isPassed, true);
  const admission = await admit();
  assert.equal(admission.status, 200, JSON.stringify(admission.data));
  assert.equal((await save(present(['shoot']))).status, 400);
  assert.equal((await save(present(onlineClasses.slice(0, 4).map(cls => cls.id)))).status, 200);
  assert.equal((await save({attendance_excuses: [{class_id: 'shoot', reason: 'Not allowed'}]})).status, 400);
  const excuse = await save({attendance_excuses: [{class_id: 'online-4', reason: 'Approved illness absence'}]});
  assert.equal(excuse.status, 200);
  assert.equal(excuse.data.progress.phases[1].classes.find(cls => cls.id === 'online-4').attended, false);
  assert.equal((await save(present(['edit']))).status, 400);
  assert.equal((await save(present(['shoot']))).status, 200);
  assert.equal((await submitFilm()).status, 403);
  assert.equal((await save(present(['edit']))).status, 200);
  assert.equal(await listCertificate(), undefined);
  const film = await submitFilm();
  assert.equal(film.status, 201, JSON.stringify(film.data));
  assert.equal((await download()).status, 403);
  assert.equal(await listCertificate(), undefined);
  const changeReview = () => request('/api/film-submissions/' + film.data.id + '/review', 'PATCH', {status: 'accepted'}, adminToken);
  assert.equal((await save({attendance_excuses: [{class_id: 'online-4', reason: null}]})).status, 200);
  assert.equal((await changeReview()).status, 409);
  assert.equal((await save({attendance_excuses: [{class_id: 'online-4', reason: 'Approved illness absence'}]})).status, 200);
  const review = await changeReview();
  assert.equal(review.status, 200, JSON.stringify(review.data));
  assert.equal((await request(progressApi, 'GET', undefined, adminToken)).data.progress.phases[1].isPassed, true);
  assert.equal(db.prepare("SELECT is_passed FROM student_phase_results WHERE enrollment_id=? AND phase_id='practical'").get(orderedId).is_passed, 1);
  assert.ok(await listCertificate());
  assert.equal((await download()).status, 200);
  console.log('PASS: ordered filmmaking from 80% exam gate through accepted film and authorized certificate download');
  await studentPage.goto(baseUrl + '/bfi-classroom/student-portal');
  const orderedCard = studentPage.getByRole('heading', {name: 'Ordered Filmmaking', exact: true}).locator('../..');
  await orderedCard.getByRole('link', {name: 'Download Certificate', exact: true}).waitFor();
  await orderedCard.getByText('Course completed', {exact: true}).waitFor();
  await adminPage.goto(baseUrl + '/bfi-classroom/admin/course-maker');
  await adminPage.getByRole('button', {name: 'Create New Course'}).click();
  adminPage.once('dialog', dialog => dialog.accept());
  await adminPage.getByRole('button', {name: 'Use two-phase filmmaking template'}).click();
  await adminPage.getByText(/Phase 1 requires 80% attendance/).waitFor();
  assert.equal(await adminPage.locator('input').evaluateAll(inputs => inputs.filter(input => input.value === 'Theory class 24').length), 1);
  const { addDays, dhakaNow, weekdayOf } = await import('../src/utils/timetable.js');
  const today = dhakaNow().date;
  const weekStart = addDays(today, -new Date(today + 'T00:00:00Z').getUTCDay());
  const cancellation = addDays(weekStart, 0);
  const original = addDays(weekStart, 1);
  const replacement = addDays(weekStart, 3);
  const batchId = Number(db.prepare(`
    INSERT INTO batches (batch_name, batch_number, course_name, course_definition_id, status)
    VALUES ('Timetable Batch', 'T1', 'Ordered Filmmaking', ?, 'ongoing')
  `).run(draft.data.id).lastInsertRowid);
  db.prepare('UPDATE student_course_enrollments SET batch_id = ? WHERE id = ?').run(batchId, orderedId);
  const routineApi = '/api/admin/course-definitions/' + draft.data.id + '/routine';
  const routine = [
    {id: 'sunday', weekday: weekdayOf(cancellation), startTime: '19:00', endTime: '21:00', classTitle: 'Sunday camera class'},
    {id: 'monday', weekday: weekdayOf(original), startTime: '19:00', endTime: '21:00', classTitle: 'Monday lighting class'},
    {id: 'marked', classId: 'theory-0', date: today, weekday: weekdayOf(today), startTime: '14:00', endTime: '15:00', classTitle: 'Marked attendance class', meetingUrl: 'https://zoom.us/j/123456789'}
  ];
  const saveRoutine = slots => request(routineApi, 'PUT', {phase_id: 'theory', batch_id: batchId, routine: slots, reason: 'Timetable browser test'}, adminToken);
  assert.equal((await saveRoutine(routine.map(slot => ({...slot, meetingUrl: 'javascript:alert(1)'})))).status, 400);
  assert.equal((await saveRoutine(routine)).status, 200);
  const windowRequest = {batchId, phaseId: 'theory', type: 'exam', assessmentId: 'exam', routineSlotId: 'marked', sessionDate: today, opensAt: `${today}T00:00`, closesAt: `${today}T23:59`};
  const legacyPhaseDefinition = {phases: [{phaseIndex: 1, title: 'Legacy phase', assignments: [{id: 'legacy-work', title: 'Legacy assignment'}]}]};
  const legacyDefinitionId = db.prepare("INSERT INTO course_definitions (slug,name,course_type,status,phase_count,definition_json,created_by,updated_by) VALUES ('phase-without-id','Phase test','course','published',1,?,1,1)").run(JSON.stringify(legacyPhaseDefinition)).lastInsertRowid;
  const legacyBatchId = db.prepare("INSERT INTO batches (batch_name,batch_number,course_name,course_definition_id) VALUES ('Legacy phase batch','L1','Phase test',?)").run(legacyDefinitionId).lastInsertRowid;
  assert.equal((await request('/api/assessment-windows', 'POST', {...windowRequest, batchId:Number(legacyBatchId), phaseId:'phase_1', type:'assignment', assessmentId:'legacy-work'}, adminToken)).status, 200);
  assert.equal((await request('/api/assessment-windows', 'POST', windowRequest, outsiderToken)).status, 403);
  assert.equal((await request('/api/assessment-windows', 'POST', {...windowRequest, assessmentId: 'unknown'}, adminToken)).status, 400);
  const savedWindow = await request('/api/assessment-windows', 'POST', windowRequest, adminToken);
  assert.equal(savedWindow.status, 200, JSON.stringify(savedWindow.data));
  const adminWindows = await request('/api/assessment-windows?batchId=' + batchId, 'GET', undefined, adminToken);
  assert.equal(adminWindows.status, 200);
  assert.equal(adminWindows.data.windows[0].assessment_id, 'exam');
  const outsiderWindows = await request('/api/assessment-windows', 'GET', undefined, outsiderToken);
  assert.equal(outsiderWindows.data.windows.length, 0);
  const ownWindows = await request('/api/assessment-windows', 'GET');
  assert.equal(ownWindows.data.windows.length, 1);
  const duplicateId = db.prepare("INSERT INTO student_course_enrollments (user_id, course_name, course_definition_id, batch_id) SELECT user_id, 'Alternate course label', course_definition_id, batch_id FROM student_course_enrollments WHERE id = ?").run(orderedId).lastInsertRowid;
  assert.equal((await request('/api/assessment-windows', 'GET')).data.windows.length, 0, 'Duplicate enrollment identities must fail closed');
  db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(duplicateId);
  db.prepare("UPDATE student_class_attendance SET attended = 0 WHERE enrollment_id = ? AND class_id = 'theory-0'").run(orderedId);
  assert.equal((await request('/api/assessment-windows', 'GET')).data.windows.length, 0, 'Exam must be hidden below the attendance threshold');
  db.prepare("UPDATE student_class_attendance SET attended = 1 WHERE enrollment_id = ? AND class_id = 'theory-0'").run(orderedId);
  const changedRoutine = routine.map(slot => slot.id === 'marked' ? {...slot, startTime: '13:00'} : slot);
  assert.equal((await saveRoutine(changedRoutine)).status, 200);
  assert.equal((await request('/api/assessment-windows', 'GET')).data.windows.length, 0, 'Changed class times require the exam window to be reconfirmed');
  assert.equal((await request('/api/assessment-windows?batchId=' + batchId, 'GET', undefined, adminToken)).data.windows[0].needsReview, true);
  assert.equal((await saveRoutine(routine)).status, 200);
  const cancelledRoutine = routine.map(slot => slot.id === 'marked' ? {...slot, sessionChanges: [{originalDate: today, status: 'cancelled'}]} : slot);
  assert.equal((await saveRoutine(cancelledRoutine)).status, 200);
  assert.equal((await request('/api/assessment-windows', 'GET')).data.windows.length, 0, 'Cancelled class must not expose its exam');
  const movedDate = addDays(today, 1);
  const movedRoutine = routine.map(slot => slot.id === 'marked' ? {...slot, sessionChanges: [{originalDate: today, status: 'rescheduled', date: movedDate, startTime: '14:00', endTime: '15:00'}]} : slot);
  assert.equal((await saveRoutine(movedRoutine)).status, 200);
  assert.equal((await request('/api/assessment-windows', 'GET')).data.windows.length, 0, 'Original exam must not remain visible after a move');
  assert.equal((await request('/api/assessment-windows', 'POST', {...windowRequest, sessionDate: movedDate, opensAt: `${movedDate}T14:00`, closesAt: `${movedDate}T16:00`}, adminToken)).status, 200);
  assert.equal((await request('/api/assessment-windows', 'GET')).data.windows.length, 1, 'Rescheduled class can receive a new assessment window');
  assert.equal((await saveRoutine(routine)).status, 200);
  assert.equal((await request('/api/assessment-windows', 'POST', windowRequest, adminToken)).status, 200);
  const assignmentWindow = await request('/api/assessment-windows', 'POST', {...windowRequest, type: 'assignment', assessmentId: 'written-assignment', opensAt: `${today}T00:00`, closesAt: `${today}T23:59`}, adminToken);
  assert.equal(assignmentWindow.status, 200, JSON.stringify(assignmentWindow.data));
  assert.equal((await request('/api/assessment-windows', 'POST', {...windowRequest, batchId: Number(definedBatch), phaseId: 'production', type: 'assignment', assessmentId: '42', opensAt: `${today}T00:00`, closesAt: `${today}T23:59`}, adminToken)).status, 200);
  assert.equal((await request('/api/assessment-windows', 'GET')).data.windows.length, 3);
  const assignmentWindowId = (await request('/api/assessment-windows', 'GET')).data.windows.find(item => item.assessmentId === 'written-assignment').id;
  const pdfDocument = new (require('pdfkit'))();
  const pdfChunks = [];
  pdfDocument.on('data', chunk => pdfChunks.push(chunk));
  const pdfReady = new Promise(resolve => pdfDocument.on('end', resolve));
  pdfDocument.text('Answer paper page one'); pdfDocument.end(); await pdfReady;
  const pdfBytes = Buffer.concat(pdfChunks);
  const examWindowId = (await request('/api/assessment-windows', 'GET')).data.windows.find(item => item.type === 'exam').id;
  const examForm = new FormData(); examForm.append('requestKey', 'graded-exam-test'); examForm.append('file', new Blob([pdfBytes], {type:'application/pdf'}), 'paper.pdf');
  const gradedExam = await fetch(baseUrl + '/api/assessment-submissions/' + examWindowId, {method:'POST', headers:{Authorization:'Bearer ' + token}, body:examForm});
  assert.equal(gradedExam.status, 409, 'A marked exam cannot silently accept a new paper');
  db.prepare("UPDATE student_phase_results SET exam_marks=NULL WHERE enrollment_id=? AND phase_id='theory'").run(orderedId);
  const newExamForm = new FormData(); newExamForm.append('requestKey', 'exam-paper-test'); newExamForm.append('file', new Blob([pdfBytes], {type:'application/pdf'}), 'exam.pdf');
  const submittedExam = await fetch(baseUrl + '/api/assessment-submissions/' + examWindowId, {method:'POST', headers:{Authorization:'Bearer ' + token}, body:newExamForm});
  assert.equal(submittedExam.status, 201, await submittedExam.clone().text());
  const examPaper = await submittedExam.json();
  assert.equal((await request('/api/assessment-submissions/' + examPaper.id + '/grade', 'PATCH', {marks: 40}, adminToken)).status, 200);
  assert.equal(db.prepare("SELECT exam_marks FROM student_phase_results WHERE enrollment_id=? AND phase_id='theory'").get(orderedId).exam_marks, 40);
  const submitPaper = async (userToken, requestKey, bytes = pdfBytes) => {
    const form = new FormData();
    form.append('requestKey', requestKey);
    form.append('file', new Blob([bytes], {type:'application/pdf'}), 'paper.pdf');
    return fetch(baseUrl + '/api/assessment-submissions/' + assignmentWindowId, {method:'POST', headers:{Authorization:'Bearer ' + userToken}, body:form});
  };
  const originalWindowTimes = db.prepare('SELECT opens_at, closes_at FROM assessment_windows WHERE id=?').get(assignmentWindowId);
  db.prepare("UPDATE assessment_windows SET opens_at='2999-01-01T00:00:00.000Z', closes_at='2999-01-02T00:00:00.000Z' WHERE id=?").run(assignmentWindowId);
  assert.equal((await submitPaper(token, 'not-open-yet')).status, 403);
  db.prepare("UPDATE assessment_windows SET opens_at='2000-01-01T00:00:00.000Z', closes_at='2000-01-02T00:00:00.000Z' WHERE id=?").run(assignmentWindowId);
  assert.equal((await submitPaper(token, 'already-closed')).status, 403);
  db.prepare('UPDATE assessment_windows SET opens_at=?, closes_at=? WHERE id=?').run(originalWindowTimes.opens_at, originalWindowTimes.closes_at, assignmentWindowId);
  assert.equal((await submitPaper(outsiderToken, 'outsider-attempt')).status, 404);
  assert.equal((await submitPaper(token, 'invalid-file', Buffer.from('not a pdf'))).status, 400);
  assert.equal((await submitPaper(token, 'oversize-file', Buffer.alloc(15 * 1024 * 1024 + 1))).status, 400);
  assert.equal((await submitPaper(token, 'graded-attempt')).status, 409);
  const priorGrade = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id = ?').get(orderedId, 'written-assignment');
  db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id = ?').run(orderedId, 'written-assignment');
  db.exec("CREATE TRIGGER reject_paper_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='assessment.submitted' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.equal((await submitPaper(token, 'paper-request-1')).status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assessment_submissions WHERE window_id=?').get(assignmentWindowId).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_assignment_grades WHERE enrollment_id=? AND assignment_id=?').get(orderedId, 'written-assignment').n, 0);
  db.exec('DROP TRIGGER reject_paper_audit');
  const firstPaper = await submitPaper(token, 'paper-request-1');
  assert.equal(firstPaper.status, 201, await firstPaper.clone().text());
  const paper = await firstPaper.json();
  const paperHistory = await request('/api/assessment-submissions/' + assignmentWindowId + '/history', 'GET');
  assert.equal(paperHistory.status, 200);
  assert.equal(paperHistory.data.submissions[0].id, paper.id);
  assert.equal((await request('/api/assessment-submissions/' + assignmentWindowId + '/history', 'GET', undefined, outsiderToken)).status, 404);
  const retryPaper = await submitPaper(token, 'paper-request-1');
  assert.equal(retryPaper.status, 200);
  assert.equal((await retryPaper.json()).id, paper.id);
  assert.equal((await submitPaper(token, 'paper-request-1', Buffer.concat([pdfBytes, Buffer.from('\n%other content\n')]))).status, 409);
  const revisedPaperResponse = await submitPaper(token, 'paper-request-2');
  assert.equal(revisedPaperResponse.status, 201);
  const revisedPaper = await revisedPaperResponse.json();
  assert.equal(revisedPaper.version, 2);
  const privateDownload = await fetch(baseUrl + '/api/assessment-submissions/files/' + paper.id, {headers:{Authorization:'Bearer ' + outsiderToken}});
  assert.equal(privateDownload.status, 404);
  const ownDownload = await fetch(baseUrl + '/api/assessment-submissions/files/' + paper.id, {headers:{Authorization:'Bearer ' + token}});
  assert.equal(ownDownload.status, 200);
  assert.deepEqual(Buffer.from(await ownDownload.arrayBuffer()), pdfBytes);
  assert.equal((await request('/api/assessment-submissions/review?batchId=' + batchId, 'GET', undefined, outsiderToken)).status, 403);
  const reviewerList = await request('/api/assessment-submissions/review?batchId=' + batchId, 'GET', undefined, adminToken);
  assert.equal(reviewerList.status, 200);
  assert.ok(reviewerList.data.submissions.some(item => item.id === paper.id));
  assert.equal((await request('/api/assessment-submissions/' + revisedPaper.id + '/grade', 'PATCH', {marks: 21}, adminToken)).status, 400);
  assert.equal((await request('/api/assessment-submissions/' + paper.id + '/grade', 'PATCH', {marks: 10, remarks: 'Good work'}, outsiderToken)).status, 403);
  assert.equal((await request('/api/assessment-submissions/' + paper.id + '/grade', 'PATCH', {marks: 10}, adminToken)).status, 409);
  db.exec("CREATE TRIGGER reject_paper_grade_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action='assessment.graded' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.equal((await request('/api/assessment-submissions/' + revisedPaper.id + '/grade', 'PATCH', {marks: 10}, adminToken)).status, 500);
  assert.equal(db.prepare('SELECT status FROM assessment_submissions WHERE id=?').get(revisedPaper.id).status, 'submitted');
  assert.equal(db.prepare('SELECT marks_obtained FROM student_assignment_grades WHERE enrollment_id=? AND assignment_id=?').get(orderedId, 'written-assignment').marks_obtained, null);
  db.exec('DROP TRIGGER reject_paper_grade_audit');
  assert.equal((await request('/api/assessment-submissions/' + revisedPaper.id + '/grade', 'PATCH', {marks: 10, remarks: 'Good work'}, adminToken)).status, 200);
  assert.equal(db.prepare('SELECT marks_obtained FROM student_assignment_grades WHERE enrollment_id = ? AND assignment_id = ?').get(orderedId, 'written-assignment').marks_obtained, 10);
  db.prepare('UPDATE student_assignment_grades SET marks_obtained = ?, submission_status = ?, remarks = ?, graded_by = ?, graded_at = ? WHERE enrollment_id = ? AND assignment_id = ?').run(priorGrade.marks_obtained, priorGrade.submission_status, priorGrade.remarks, priorGrade.graded_by, priorGrade.graded_at, orderedId, 'written-assignment');
  const studentSchedule = await request('/api/student/schedule');
  assert.equal(studentSchedule.data.batches.find(batch => batch.batchId === batchId).phases.find(phase => phase.phaseId === 'theory').schedule.find(slot => slot.id === 'marked').meetingUrl, 'https://zoom.us/j/123456789');
  process.env.ZOOM_CLIENT_ID = 'test-client'; process.env.ZOOM_CLIENT_SECRET = 'test-secret';
  const zoomBody = {batchId, phaseId:'theory', slotId:'marked', date:today};
  assert.equal((await request('/api/zoom-meetings/join', 'POST', zoomBody, outsiderToken)).status, 404);
  assert.equal((await request('/api/zoom-meetings/join', 'POST', {...zoomBody, slotId:'missing'})).status, 404);
  const join = await request('/api/zoom-meetings/join', 'POST', zoomBody);
  assert.equal(join.status, 200, JSON.stringify(join.data));
  assert.equal(jwt.verify(join.data.signature, 'test-secret').role, 0);
  assert.equal(join.data.meetingNumber, '123456789');
  assert.equal(JSON.stringify(join.data).includes('test-secret'), false);
  delete process.env.ZOOM_CLIENT_ID; delete process.env.ZOOM_CLIENT_SECRET;
  const secondRoutine = [{ id: 'workshop-slot', date: today, weekday: weekdayOf(today), startTime: '19:00', endTime: '21:00', classTitle: 'Workshop scene analysis', teacherUserId: assigned }];
  const secondRoutineResponse = await request('/api/admin/course-definitions/' + defId + '/routine', 'PUT',
    { phase_id: 'production', batch_id: Number(definedBatch), routine: secondRoutine, reason: 'Second course timeline browser test' }, adminToken);
  assert.equal(secondRoutineResponse.status, 200, JSON.stringify(secondRoutineResponse.data));
  await studentPage.goto(baseUrl + '/bfi-classroom/');
  const timeline = studentPage.locator('.class-timeline');
  await timeline.getByRole('heading', { name: 'Class routine' }).waitFor();
  await timeline.getByRole('button', { name: /Marked attendance class.*Present/ }).waitFor();
  await timeline.getByRole('button', { name: /Marked attendance class/ }).click();
  await timeline.getByText('Open Classroom to join the meeting.').waitFor();
  await timeline.locator('.class-timeline__detail').getByRole('link', {name: 'Open Classroom'}).click();
  await studentPage.getByRole('region', {name: 'Weekly timetable'}).getByRole('link', {name: 'Join meeting'}).waitFor();
  await studentPage.getByRole('region', {name: 'Weekly timetable'}).locator('.classroom-selected-session').getByText('Marked attendance class', {exact: true}).waitFor();
  if (process.env.TEST_ZOOM_EMBED === 'true' || process.env.TEST_ZOOM_REAL_BUNDLE === 'true') {
    process.env.ZOOM_CLIENT_ID = 'test-client'; process.env.ZOOM_CLIENT_SECRET = 'test-secret';
    if (process.env.TEST_ZOOM_EMBED === 'true') await studentPage.route('http://127.0.0.1:48802/index.html', route => route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><script>window.addEventListener('message',e=>{if(e.data.type==='BFI_ZOOM_PING')parent.postMessage({type:'BFI_ZOOM_READY'},'*');if(e.data.type==='BFI_ZOOM_JOIN')document.body.textContent=e.data.meetingNumber}); parent.postMessage({type:'BFI_ZOOM_READY'},'*');</script><body>waiting</body>`}));
    await studentPage.getByRole('button', {name:'Join in Classroom'}).click();
    if (process.env.TEST_ZOOM_EMBED === 'true') await studentPage.frameLocator('iframe[title="Zoom classroom"]').getByText('123456789', {exact:true}).waitFor();
    else await studentPage.frameLocator('iframe[title="Zoom classroom"]').getByText(/Connecting to Zoom|Could not initialize Zoom|Could not join the meeting/).waitFor({timeout:15000}).catch(async error => {console.error('SDK FRAME STATUS:', await studentPage.frameLocator('iframe[title="Zoom classroom"]').locator('body').innerText()); throw error;});
    await studentPage.getByRole('button', {name:'Close meeting'}).click();
    delete process.env.ZOOM_CLIENT_ID; delete process.env.ZOOM_CLIENT_SECRET;
  }
  assert.equal(await studentPage.getByRole('region', {name: 'Weekly timetable'}).locator('.classroom-selected-session').getByRole('link', {name: 'Join meeting'}).getAttribute('href'), 'https://zoom.us/j/123456789');
  await studentPage.getByRole('region', {name: 'Assessments'}).getByText('Theory exam', {exact: true}).waitFor();
  db.prepare("UPDATE assessment_windows SET opens_at='2000-01-01T00:00:00.000Z', closes_at='2000-01-02T00:00:00.000Z' WHERE id=?").run(assignmentWindowId);
  await studentPage.reload();
  await studentPage.getByRole('region', {name:'Assessments'}).locator('li').filter({hasText:'Written assignment'}).getByRole('link', {name:'View submissions and results'}).click();
  await studentPage.getByText('Version 1', {exact:false}).first().waitFor();
  db.prepare('UPDATE assessment_windows SET opens_at=?, closes_at=? WHERE id=?').run(originalWindowTimes.opens_at, originalWindowTimes.closes_at, assignmentWindowId);
  await studentPage.goto(baseUrl + '/bfi-classroom/');
  await timeline.getByRole('heading', { name: 'Class routine' }).waitFor();
  await timeline.getByRole('button', { name: /Marked attendance class/ }).click();
  await timeline.locator('.class-timeline__detail').getByRole('link', {name: 'Open Classroom'}).click();
  await studentPage.getByRole('region', {name: 'Assessments'}).locator('li').filter({hasText: 'Written assignment'}).getByRole('link', {name: 'Submit answer paper'}).click();
  await studentPage.getByRole('heading', {name: 'Submit answer paper'}).waitFor();
  await studentPage.getByText('Version 1', {exact: false}).first().waitFor();
  await studentPage.getByText('This assessment has already been graded.').waitFor();
  await studentPage.goto(baseUrl + '/bfi-classroom/');
  await timeline.getByRole('heading', { name: 'Class routine' }).waitFor();
  await timeline.getByRole('button', { name: /Marked attendance class/ }).click();
  await timeline.locator('.class-timeline__detail').getByRole('link', {name: 'Open Classroom'}).click();
  await studentPage.goto(baseUrl + '/bfi-classroom/classroom?batch_id=' + definedBatch + '&phase_id=production');
  await studentPage.getByRole('region', {name: 'Assessments'}).locator('li').filter({hasText: 'Photo assignment'}).getByRole('link', {name: 'Submit answer paper'}).click();
  await studentPage.getByLabel('PDF answer paper').setInputFiles({name: 'answer.pdf', mimeType: 'application/pdf', buffer: pdfBytes});
  await studentPage.getByText('answer.pdf', {exact: false}).waitFor();
  const sharp = require('sharp');
  const red = await sharp({create:{width:50,height:70,channels:3,background:'#ff0000'}}).jpeg().toBuffer();
  const blue = await sharp({create:{width:50,height:70,channels:3,background:'#0000ff'}}).jpeg().toBuffer();
  await studentPage.getByLabel('JPG pages').setInputFiles([{name:'first.jpg',mimeType:'image/jpeg',buffer:red},{name:'second.jpg',mimeType:'image/jpeg',buffer:blue}]);
  const imagePages = studentPage.locator('main ol li');
  await imagePages.nth(1).getByRole('button', {name:'Move up'}).click();
  assert.match(await imagePages.nth(0).innerText(), /second\.jpg/);
  await imagePages.nth(0).getByRole('button', {name:'Rotate'}).click();
  await studentPage.getByRole('button', {name:'Submit PDF'}).click();
  await studentPage.getByText(/Submitted successfully/).waitFor();
  const photoRow = db.prepare("SELECT s.pdf_data FROM assessment_submissions s JOIN assessment_windows w ON w.id=s.window_id WHERE w.assessment_id='42'").get();
  assert.equal((await request('/api/assessment-submissions/review?batchId=' + definedBatch, 'GET', undefined, instructorToken)).status, 200);
  assert.equal((await request('/api/assessment-submissions/review?batchId=' + definedBatch, 'GET', undefined, otherTeacherToken)).status, 403);
  const teacherReviewPage = await browser.newPage({viewport:{width:1280,height:800}});
  await teacherReviewPage.addInitScript(accessToken => localStorage.setItem('token', accessToken), instructorToken);
  await teacherReviewPage.goto(baseUrl + '/bfi-classroom/assessment-review?batch_id=' + definedBatch);
  await teacherReviewPage.getByRole('region', {name:'Submitted answer papers'}).getByText(/42/).waitFor();
  await teacherReviewPage.close();
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const photoTask = getDocument({data:new Uint8Array(photoRow.pdf_data), isEvalSupported:false});
  const photoDoc = await photoTask.promise;
  assert.equal(photoDoc.numPages, 2);
  await photoTask.destroy();
  await adminPage.goto(baseUrl + '/bfi-classroom/admin/batchmanager/' + definedBatch);
  const photoReview = adminPage.getByRole('region', {name:'Submitted answer papers'}).locator('article').filter({hasText:'42'});
  await photoReview.getByLabel('Marks').fill('15');
  await photoReview.getByLabel('Feedback').fill('Good sequencing');
  await photoReview.getByRole('button', {name:'Save marks'}).click();
  await photoReview.getByText(/Marks: 15/).waitFor();
  assert.equal(db.prepare("SELECT marks_obtained FROM student_assignment_grades WHERE enrollment_id=? AND assignment_id='42'").get(defined).marks_obtained, 15);
  assert.equal((await request('/api/admin/students/' + userId + '/courses/' + defined + '/defined-progress', 'GET', undefined, adminToken)).data.progress.phases.find(phase => phase.id === 'production').assignments.find(item => item.id === 42).marksObtained, 15);
  const removeWithPapers = await request('/api/admin/students/' + userId, 'PUT', {firstName: 'Film', lastName: 'Student', username: 'film_student', email:'film@example.test', courses:['Online Filmmaking Course','Course Maker Film']}, adminToken);
  assert.equal(removeWithPapers.status, 409, JSON.stringify(removeWithPapers.data));
  assert.ok(db.prepare('SELECT id FROM student_course_enrollments WHERE id=?').get(orderedId));
  await studentPage.goto(baseUrl + '/bfi-classroom/');
  await timeline.getByRole('heading', { name: 'Class routine' }).waitFor();
  await timeline.getByRole('button', { name: /Marked attendance class/ }).click();
  await timeline.locator('.class-timeline__detail').getByRole('link', {name: 'Open Classroom'}).click();
  assert.equal(await studentPage.getByRole('region', {name: 'Weekly timetable'}).getByRole('link', {name: 'Join meeting'}).getAttribute('href'), 'https://zoom.us/j/123456789');
  await studentPage.goto(baseUrl + '/bfi-classroom/');
  await timeline.getByRole('heading', { name: 'Class routine' }).waitFor();
  if (engine === 'chromium') {
    const touchTrack = timeline.locator('.class-timeline__course').filter({hasText: 'Ordered Filmmaking'}).locator('.class-timeline__track').first();
    await touchTrack.scrollIntoViewIfNeeded();
    await touchTrack.evaluate(element => { element.scrollLeft = 0; });
    const box = await touchTrack.boundingBox();
    const cdp = await studentPage.context().newCDPSession(studentPage);
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: box.x + box.width - 25, y: box.y + box.height / 2}]});
    for (let distance = 20; distance <= 180; distance += 20) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: box.x + box.width - 25 - distance, y: box.y + box.height / 2}]});
    }
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    assert.ok(await touchTrack.evaluate(element => element.scrollLeft > 0), 'Touch swipe scrolls the class map');
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: false});
    await cdp.detach();
  }
  const node = timeline.getByRole('button', { name: /Monday lighting class/ }).last();
  const selectedDate = (await node.locator('span').first().textContent()).match(/\d{4}-\d{2}-\d{2}/)[0];
  await node.scrollIntoViewIfNeeded();
  await node.click();
  const details = timeline.locator('.class-timeline__detail');
  await details.getByRole('heading', { name: 'Monday lighting class' }).waitFor();
  await details.getByRole('link', { name: 'Open Classroom' }).click();
  await studentPage.waitForURL(url => url.pathname.endsWith('/classroom') && url.searchParams.get('batch_id') === String(batchId) && url.searchParams.get('phase_id') === 'theory' && url.searchParams.get('date') === selectedDate);
  await studentPage.getByRole('region', { name: 'Weekly timetable' }).getByText('Monday lighting class', { exact: true }).waitFor();
  await studentPage.getByRole('region', { name: 'Weekly timetable' }).locator(`time[datetime="${selectedDate}"]`).waitFor();
  console.log('PASS: dashboard timeline opens the selected batch and phase in Classroom');

  await studentPage.setViewportSize({ width: 1280, height: 800 });
  await studentPage.goto(baseUrl + '/bfi-classroom/');
  await timeline.getByRole('heading', { name: 'Class routine' }).waitFor();
  const firstCourse = timeline.locator('.class-timeline__course').filter({ hasText: 'Ordered Filmmaking' });
  const secondCourse = timeline.locator('.class-timeline__course').filter({ hasText: 'Course Maker Film' });
  await firstCourse.getByRole('button', { name: /Monday lighting class/ }).first().waitFor();

  const desktopTrack = firstCourse.locator('.class-timeline__track').first();
  await desktopTrack.evaluate(element => { element.scrollLeft = 0; });
  const trackBounds = await desktopTrack.boundingBox();
  assert.ok(trackBounds);
  await studentPage.mouse.move(trackBounds.x + trackBounds.width - 3, trackBounds.y + 4);
  await studentPage.mouse.down();
  await studentPage.mouse.move(trackBounds.x + trackBounds.width - 150, trackBounds.y + 4, { steps: 5 });
  await studentPage.mouse.up();
  assert.ok(await desktopTrack.evaluate(element => element.scrollLeft > 0), 'Mouse dragging scrolls the class map');

  await secondCourse.getByRole('button', { name: /Workshop scene analysis/ }).waitFor();
  await secondCourse.getByRole('button', { name: /Workshop scene analysis/ }).click();
  await timeline.locator('.class-timeline__detail').getByRole('heading', { name: 'Workshop scene analysis' }).waitFor();
  const waitForSocket = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (sockets.sockets.adapter.rooms.get('user:' + userId)?.size) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Dashboard socket did not connect');
  };
  await waitForSocket();
  const updatedSecondRoutine = [{ ...secondRoutine[0], classTitle: 'Updated workshop scene analysis' }];
  const updateResponse = await request('/api/admin/course-definitions/' + defId + '/routine', 'PUT',
    { phase_id: 'production', batch_id: Number(definedBatch), routine: updatedSecondRoutine, reason: 'Updated timeline browser test' }, adminToken);
  assert.equal(updateResponse.status, 200, JSON.stringify(updateResponse.data));
  await secondCourse.getByRole('button', { name: /Updated workshop scene analysis/ }).waitFor();
  assert.equal(await timeline.locator('.class-timeline__detail').count(), 0);
  await secondCourse.getByRole('button', { name: /Updated workshop scene analysis/ }).click();
  await timeline.locator('.class-timeline__detail').getByRole('link', { name: 'Open Classroom' }).click();
  await studentPage.waitForURL(url => url.pathname.endsWith('/classroom') && url.searchParams.get('batch_id') === String(definedBatch) && url.searchParams.get('phase_id') === 'production');
  await studentPage.getByText('Updated workshop scene analysis', { exact: true }).first().waitFor();
  await studentPage.setViewportSize({ width: 390, height: 844 });
  console.log('PASS: desktop dashboard shows two enrolled courses and opens the selected second course');


  const connection = new Promise(resolve => sockets.on('connection', socket => {
    if (socket.data.userId === userId) resolve();
  }));
  await studentPage.goto(baseUrl + '/bfi-classroom/classroom');
  const week = studentPage.getByRole('region', {name: 'Weekly timetable'});
  await week.getByText('Monday lighting class', {exact: true}).waitFor();
  await Promise.race([connection, new Promise((_, reject) => setTimeout(() => reject(new Error('Student socket not connected')), 5000).unref())]);
  const changes = [
    {...routine[0], sessionChanges: [{originalDate: cancellation, status: 'cancelled'}]},
    {...routine[1], sessionChanges: [{originalDate: original, status: 'rescheduled', date: replacement, startTime: '20:00', endTime: '22:00'}]}
  ];
  const invalidDay = [{...routine[0], sessionChanges: [{originalDate: original, status: 'cancelled'}]}];
  assert.equal((await saveRoutine(invalidDay)).status, 400);
  const overlap = [...changes, {weekday: weekdayOf(replacement), startTime: '21:00', endTime: '23:00'}];
  assert.equal((await saveRoutine(overlap)).status, 400);
  await adminPage.goto(baseUrl + '/bfi-classroom/admin/batchmanager/' + batchId);
  const reviews = adminPage.getByRole('region', {name: 'Submitted answer papers'});
  await reviews.getByText('Film Student', {exact: false}).first().waitFor();
  await reviews.getByText('graded', {exact: false}).first().waitFor();
  const scheduler = adminPage.getByRole('region', {name: 'Assessment scheduling'});
  await scheduler.getByLabel('Phase', {exact: true}).selectOption('theory');
  await scheduler.getByLabel('Assessment', {exact: true}).selectOption('exam:exam');
  await scheduler.getByLabel('Routine class').selectOption('marked');
  await scheduler.getByLabel('Exam date').fill(today);
  await scheduler.getByLabel('Opens (Bangladesh time)').fill(`${today}T14:00`);
  await scheduler.getByLabel('Deadline (Bangladesh time)').fill(`${today}T16:00`);
  await scheduler.getByRole('button', {name: 'Save assessment schedule'}).click();
  await scheduler.getByText('Assessment schedule saved.').waitFor();
  await adminPage.getByRole('button', {name: 'Adjust Routine', exact: true}).first().click();
  const editors = adminPage.locator('details').filter({has: adminPage.locator('summary', {hasText: 'Cancel or reschedule a session'})});
  for (const [index, originalDate] of [cancellation, original].entries()) {
    const editor = editors.nth(index);
    await editor.locator('summary').click();
    await editor.getByRole('button', {name: 'Add session change'}).click();
    await editor.getByLabel('Original class date').fill(originalDate);
    if (index === 1) {
      await editor.getByRole('combobox').selectOption('rescheduled');
      await editor.getByLabel('New date', {exact: true}).fill(replacement);
      await editor.getByLabel('New start time', {exact: true}).fill('20:00');
      await editor.getByLabel('New end time', {exact: true}).fill('22:00');
    }
  }
  await adminPage.getByPlaceholder(/Adjusted shooting schedule/).fill('Timetable browser test');
  const saveResponse = adminPage.waitForResponse(response => response.url().endsWith(routineApi) && response.request().method() === 'PUT');
  await adminPage.getByRole('button', {name: 'Save Batch Schedule', exact: true}).click();
  const changeResult = await saveResponse;
  assert.equal(changeResult.status(), 200, await changeResult.text());
  await week.getByText('Cancelled', {exact: true}).waitFor({timeout: 5000});
  await week.getByText('Rescheduled from ' + original, {exact: true}).waitFor({timeout: 5000});
  await week.getByText('20:00 - 22:00', {exact: true}).waitFor();
  await studentPage.getByRole('button', {name: 'Next week', exact: true}).click();
  await week.getByText('Monday lighting class', {exact: true}).waitFor();
  assert.equal(await week.getByText('Cancelled', {exact: true}).count(), 0);
  assert.equal(await week.getByText('Rescheduled from ' + original, {exact: true}).count(), 0);
  assert.equal(await week.getByText('19:00 - 21:00', {exact: true}).count(), 2);
  console.log('PASS: live timetable update, cancelled and moved occurrences, overlap rejection, and unchanged weekly recurrence');
  const preferenceApi = '/api/notifications/preferences';
  const defaultPrefs = {notices: true, materials: true, messages: true, community: true};
  assert.deepEqual((await request(preferenceApi)).data.preferences, defaultPrefs);
  assert.equal((await request(preferenceApi, 'GET', undefined, adminToken)).status, 403);
  assert.equal((await request(preferenceApi, 'PATCH', {materials: 'false'})).status, 400);
  assert.equal((await request(preferenceApi, 'PATCH', {notices: false, user_id: outsider})).status, 400);
  db.prepare("UPDATE student_profiles SET batch_number='T1' WHERE user_id=?").run(userId);
  db.prepare("INSERT INTO student_profiles (user_id,student_id,full_name,batch_number) VALUES (?,'NF-OTHER','Other Student','T1')").run(outsider);
  db.prepare("INSERT INTO batch_students (batch_id,student_id) VALUES (?,?)").run(batchId, outsider);
  const outsideBatch = Number(db.prepare("INSERT INTO batches (batch_name,batch_number,course_name,status) VALUES ('Private target','N9','Unrelated Course','ongoing')").run().lastInsertRowid);

  // Existing notices disappear from the alert list and unread count when muted.
  const addNotification = db.prepare("INSERT INTO notifications (user_id,type,title) VALUES (?,?,?)");
  addNotification.run(userId, 'notice', 'Old notice');
  const unreadCount = async () => (await request('/api/notifications/unread-count')).data.unreadCount;
  const baselineUnread = await unreadCount();
  await studentPage.goto(baseUrl + '/bfi-classroom/settings');
  const settings = studentPage.getByRole('region', {name: 'Notification preferences'});
  for (const label of ['New notices','New course materials','Messages','Community activity']) {
    const toggle = settings.getByRole('switch', {name: label, exact: true});
    await toggle.click();
    await settings.getByRole('status').filter({hasText: 'Preference saved.'}).waitFor();
  }
  assert.equal(await unreadCount(), baselineUnread - 1);
  await studentPage.reload();
  const notices = settings.getByRole('switch', {name: 'New notices', exact: true});
  await notices.waitFor();
  assert.equal(await settings.getByRole('switch', {checked: false}).count(), 4);
  assert.deepEqual((await request(preferenceApi, 'GET', undefined, outsiderToken)).data.preferences, defaultPrefs);
  const notice = await request('/api/admin/announcements', 'POST', {title:'Preference test notice', content:'Visible from the board'}, adminToken);
  assert.equal(notice.status, 201, JSON.stringify(notice.data));
  const post = await request('/api/community/posts', 'POST', {content:'Preference test post', audience:'public'}, adminToken);
  assert.equal(post.status, 201, JSON.stringify(post.data));
  const material = batch_id => request('/api/courses/upload', 'POST', {title:'Preference test material', batch_id, external_url:'https://example.test/lesson.pdf'}, adminToken);
  assert.equal((await material(batchId)).status, 201);
  assert.equal((await material(outsideBatch)).status, 201);
  for (const type of ['notice', 'community', 'course_material']) {
    const count = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type=? AND COALESCE(message,'') LIKE 'Preference test%'");
    if (type !== 'community') assert.equal(count.get(userId,type).n, 0);
    const received = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type=?");
    assert.equal(received.get(outsider,type).n, 1, 'Unmuted student received ' + type);
    if (type !== 'notice') assert.equal(received.get(userId,type).n, 0, 'Muted student did not receive ' + type);
  }
  assert.equal(addNotification.run(userId, 'urgent_broadcast', 'Urgent broadcast').changes, 1);
  assert.equal(addNotification.run(userId, 'fee_reminder', 'Payment reminder').changes, 1);
  const materials = (await request('/api/courses')).data.materials;
  assert.equal(materials.filter(item => item.title === 'Preference test material').length, 1);
  const message = await request('/api/inbox/messages', 'POST', {receiver_id: userId, content:'Muted alert, delivered message'}, outsiderToken);
  assert.equal(message.status, 201, JSON.stringify(message.data));
  const chats = (await request('/api/inbox/conversations')).data.chats;
  assert.ok(chats.some(chat => Number(chat.other_user_id) === outsider && Number(chat.unread_count) >= 1));
  const inboxBadge = studentPage.locator('a[href$="/inbox"] .nav-badge, a[href$="/inbox"] .bottom-nav-badge').first();
  assert.equal(await inboxBadge.count(), 0);
  await settings.getByRole('switch', {name:'Messages', exact:true}).click();
  await inboxBadge.waitFor({state:'attached'});
  await notices.click();
  await settings.getByRole('status').filter({hasText: 'Preference saved.'}).waitFor();
  const restored = await request('/api/admin/announcements', 'POST', {title:'Alerts restored', content:'Newly enabled preference'}, adminToken);
  assert.equal(restored.status,201);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type='notice' AND message='Alerts restored'").get(userId).n, 1);
  console.log('PASS: four Settings switches, persistent independent preferences, muted notice/material/community delivery and unread count, urgent/payment alerts and working Inbox');

  const migration=require('../server/db/migrations/20261109_film_submissions.cjs');
  const count=db.prepare('SELECT count(*) AS n FROM film_submissions').get().n;
  const migrationRun=require('child_process').spawnSync(process.execPath,[path.resolve(__dirname,'run_migrations.cjs'),process.env.DATABASE_PATH],{encoding:'utf8'});
  assert.equal(migrationRun.status,0,migrationRun.stdout+ migrationRun.stderr);
  migration.ensureFilmSubmissionSchema(db); migration.ensureFilmSubmissionSchema(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM film_submissions').get().n,count);
  console.log(`PASS: ${engine} mobile student history/status, admin acceptance, timeline integration, no automatic academic pass; Course Maker phase eligibility and custom phase IDs`);
}

run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();
 if(sockets)sockets.disconnectSockets(true);
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 if(db)db.close();
 fs.rmSync(directory,{recursive:true,force:true});
});
