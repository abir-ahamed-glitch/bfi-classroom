// Real compiled Student Portal and student routes, using a disposable database only.
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const os = require('os');
const express = require('express');
const jwt = require('jsonwebtoken');
const playwright = require('playwright');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bfi-film-submission-'));
process.env.DATABASE_PATH = path.join(directory, 'journey.sqlite');
process.env.JWT_SECRET = 'isolated-journey-browser-test-secret';
process.env.NODE_ENV = 'test';
let db, server, browser;

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
  app.use('/api/student',(await import('../server/routes/student.js')).default);
  app.use('/api/auth',(await import('../server/routes/auth.js')).default);
  app.use('/api/film-submissions',(await import('../server/routes/film-submissions.js')).default);
  app.use('/api/admin',(await import('../server/routes/admin.js')).default);
  app.use('/api/admin/course-definitions',(await import('../server/routes/course-definitions.js')).default);
  app.use('/api/certification',(await import('../server/routes/certification.js')).default);
  const dist=path.resolve(__dirname,'../dist');
  app.use('/bfi-classroom',express.static(dist,{dotfiles:'allow'}));
  app.get('/bfi-classroom/{*path}',(_req,res)=>res.sendFile('index.html',{root:dist,dotfiles:'allow'}));
  server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
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
  assert.equal((await request('/api/film-submissions','POST',payload)).status,409);
  assert.equal((await request(`/api/film-submissions/${initial.data.id}/review`,'PATCH',{status:'accepted'})).status,403);
  assert.equal((await request(`/api/film-submissions/${initial.data.id}/review`,'PATCH',{status:'changes_requested'},adminToken)).status,400);
  const reviewUrl=`/api/film-submissions/${initial.data.id}/review`;
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
  await studentPage.addInitScript(({token,userId})=>{localStorage.setItem('token',token);localStorage.setItem('auth_user_cache',JSON.stringify({id:userId,role:'student',username:'film_student'}));},{token,userId});
  await studentPage.goto(baseUrl+'/bfi-classroom/film-submissions');
  await studentPage.getByRole('heading',{name:/My revised film.*Version 2/}).waitFor();
  assert.equal(await studentPage.getByText('Under Review',{exact:true}).count(),1);
  assert.equal(await studentPage.getByText('Please improve sound.',{exact:false}).count(),1);
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
  await studentPage.reload();
  const foundation=studentPage.locator('.film-phase').filter({has:studentPage.getByRole('heading',{name:/Phase 1.*Foundation/})});
  await foundation.getByLabel('Film title').fill('Foundation exercise');
  await foundation.getByLabel('YouTube or Vimeo video link').fill('https://vimeo.com/123456789');
  await foundation.getByRole('button',{name:'Submit film for review'}).click();
  await foundation.getByRole('heading',{name:/Foundation exercise.*Version 1/}).waitFor();
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
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 if(db)db.close();
 fs.rmSync(directory,{recursive:true,force:true});
});
