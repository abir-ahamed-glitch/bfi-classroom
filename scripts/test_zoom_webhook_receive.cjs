const assert = require('assert/strict');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

(async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE app_migrations(name TEXT PRIMARY KEY)');
  require('../server/db/migrations/20261116_zoom_events.cjs').ensureZoomEvents(db);
  const {createZoomWebhookRouter} = await import('../server/routes/zoom-webhook.js');
  const {createZoomBindingStore} = await import('../server/services/zoomBindingStore.js');
  const {createZoomParticipantStore, isZoomEnrollmentEligible} = await import('../server/services/zoomParticipantStore.js');
  const {createZoomAttendanceApproval} = await import('../server/services/zoomAttendanceApproval.js');
  const {configuredZoomAttendanceStart, createZoomAutomaticAttendanceRunner} = await import('../server/services/zoomAutomaticAttendance.js');
  const app = express();
  app.use('/zoom', createZoomWebhookRouter(db, {enabled: true, secret: 'test-secret', accountId: 'account-test'}));
  const server = await new Promise(resolve => {const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url = `http://127.0.0.1:${server.address().port}/zoom`;
  async function send(value, override={}) {
    const body = JSON.stringify(value), timestamp = String(Math.floor(Date.now()/1000));
    const signature = 'v0=' + crypto.createHmac('sha256','test-secret').update(`v0:${timestamp}:${body}`).digest('hex');
    return fetch(url, {method:'POST', headers:{'content-type':'application/json','x-zm-request-timestamp':timestamp,'x-zm-signature':signature,...override}, body});
  }
  try {
    const challenge = await send({event:'endpoint.url_validation',payload:{plainToken:'test-challenge'}});
    assert.equal(challenge.status,200);
    assert.equal((await challenge.json()).encryptedToken, crypto.createHmac('sha256','test-secret').update('test-challenge').digest('hex'));
    const event = {event:'meeting.participant_joined', event_ts:1700000000000,payload:{account_id:'account-test',object:{id:123456789,uuid:'meeting-instance',participant:{user_id:'meeting-participant',join_time:'2026-11-16T12:00:00Z'}}}};
    assert.equal((await send(event, {'x-zm-signature':'v0='+'0'.repeat(64)})).status,401);
    assert.equal((await send(event, {'x-zm-request-timestamp':'1700000000'})).status,401);
    assert.equal((await send({...event,payload:{...event.payload,account_id:'wrong'}})).status,403);
    assert.equal((await send({...event,payload:{...event.payload,object:{...event.payload.object,uuid:''}}})).status,400);
    const noTimezone = {...event,payload:{...event.payload,object:{...event.payload.object,participant:{...event.payload.object.participant,join_time:'2026-11-16T12:00:00'}}}};
    assert.equal((await send(noTimezone)).status,400);
    const impossibleDate = {...event,payload:{...event.payload,object:{...event.payload.object,participant:{...event.payload.object.participant,join_time:'2026-02-30T12:00:00Z'}}}};
    assert.equal((await send(impossibleDate)).status,400);
    const leapDate = {...event,payload:{...event.payload,object:{...event.payload.object,participant:{...event.payload.object.participant,join_time:'2024-02-29T12:00:00Z'}}}};
    assert.equal((await send(leapDate)).status,200);
    assert.equal((await send(event)).status,200);
    assert.equal((await send(event)).status,200);
    const equivalent = {...event,payload:{...event.payload,object:{...event.payload.object,participant:{...event.payload.object.participant,join_time:'2026-11-16T18:00:00+06:00'}}}};
    assert.equal((await send(equivalent)).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM zoom_event_receipts').get().n,2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM zoom_event_receipts WHERE status=?').get('unmatched').n,2);
    const target = {batchId: 17, phaseId: 'phase-2', classId: 'editing', slotId: 'slot-4', date: '2026-11-16'};
    let schedule = {...target, classes: [{id:'editing'}], slots: [{id:'slot-4', classId:'editing', date:target.date,
      startTime:'18:00', endTime:'20:00', meetingUrl:'https://zoom.us/j/123456789'}]};
    const store = createZoomBindingStore(db, () => schedule);
    const receipt = db.prepare('SELECT id FROM zoom_event_receipts WHERE occurred_at LIKE ?').get('2026-11-16%');
    assert.deepEqual(store.options(target.batchId, target.phaseId, target.date), [{
      slotId: 'slot-4', classId: 'editing', title: 'editing', startTime: '18:00', meetingId: '123456789',
      receipts: [{id: receipt.id, firstEventAt: '2026-11-16T12:00:00.000Z', bound: false}]
    }]);
    assert.deepEqual(store.options(target.batchId, target.phaseId, '2026-11-17'), []);
    assert.equal(store.resolve(receipt.id), null);
    assert.equal(store.bind(999, target, 1).status, 'missing');
    assert.equal(store.bind(receipt.id, {...target, classId:'wrong'}, 1).status, 'invalid');
    assert.equal(store.bind(receipt.id, target, 1).status, 'created');
    assert.equal(store.bind(receipt.id, target, 1).status, 'existing');
    assert.equal(store.bind(receipt.id, {...target, slotId:'slot-5'}, 1).status, 'conflict');
    assert.equal(store.resolve(receipt.id).classId, 'editing');
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, is_active INTEGER, first_name TEXT, last_name TEXT);
      CREATE TABLE batches (id INTEGER PRIMARY KEY, course_definition_id INTEGER);
      CREATE TABLE student_course_enrollments (id INTEGER PRIMARY KEY, user_id INTEGER, batch_id INTEGER, course_definition_id INTEGER);
      CREATE TABLE student_profiles (user_id INTEGER PRIMARY KEY, student_id TEXT);
      INSERT INTO users VALUES (1, 'student', 1, 'First', 'Student'), (2, 'student', 1, 'Second', 'Student'),
        (3, 'student', 1, 'Other', 'Batch');
      INSERT INTO batches VALUES (17, 101), (18, 101);
      INSERT INTO student_course_enrollments VALUES (10, 1, 17, 101), (11, 2, 17, 101), (88, 3, 18, 101)`);
    let admitted = true;
    const participants = createZoomParticipantStore(db, store, (id, binding) =>
      isZoomEnrollmentEligible(db, id, binding, () => ({phases: [{id: 'phase-2', isAdmitted: admitted, isLocked: false, classes: [{id: 'editing'}]}]})));
    assert.equal(participants.resolve(receipt.id), null);
    assert.equal(participants.verify(receipt.id, 88, 1).status, 'ineligible');
    assert.equal(participants.verify(receipt.id, 10, 1).status, 'created');
    assert.deepEqual(participants.evidence(receipt.id), {seconds: 0, scheduledSeconds: 7200, incomplete: true});
    for (const [type, time] of [['leave', '12:30'], ['join', '12:40'], ['leave', '14:10']]) {
      const activity = structuredClone(event);
      activity.event = type === 'join' ? 'meeting.participant_joined' : 'meeting.participant_left';
      activity.payload.object.participant = {
        user_id: 'meeting-participant', [`${type}_time`]: `2026-11-16T${time}:00Z`
      };
      assert.equal((await send(activity)).status, 200);
    }
    assert.deepEqual(participants.evidence(receipt.id), {seconds: 6600, scheduledSeconds: 7200, incomplete: false});
    db.exec(`CREATE TABLE student_class_attendance (enrollment_id INTEGER, class_id TEXT, attended INTEGER);
      CREATE TABLE course_attendance_excuses (enrollment_id INTEGER, class_id TEXT);
      CREATE TABLE test_attendance_audit (enrollment_id INTEGER)`);
    let failAudit = true;
    const approve = createZoomAttendanceApproval(db, participants, identity => {
      db.prepare('INSERT INTO student_class_attendance VALUES (?, ?, 1)').run(identity.enrollmentId, identity.classId);
      if (failAudit) throw new Error('Audit failed');
      db.prepare('INSERT INTO test_attendance_audit VALUES (?)').run(identity.enrollmentId);
    });
    const expected = {enrollmentId: 10, seconds: 6600, scheduledSeconds: 7200};
    schedule.zoomMinSessionPercent = 95;
    assert.deepEqual(participants.evidence(receipt.id).policy, {minimumPercent: 95, minimumSeconds: 6840, meetsMinimum: false});
    assert.equal(approve(receipt.id, expected), 'changed');
    assert.equal(approve(receipt.id, {...expected, minimumPercent: 95}), 'below-minimum');
    schedule.zoomMinSessionPercent = 90;
    assert.deepEqual(participants.evidence(receipt.id).policy, {minimumPercent: 90, minimumSeconds: 6480, meetsMinimum: true});
    const config = {ZOOM_AUTO_ATTENDANCE_ENABLED:'true', ZOOM_WEBHOOK_ENABLED:'true',
      ZOOM_WEBHOOK_SECRET:'test-secret', ZOOM_ACCOUNT_ID:'account-test', ZOOM_AUTO_ATTENDANCE_FROM:target.date};
    assert.equal(configuredZoomAttendanceStart({}), null);
    assert.equal(configuredZoomAttendanceStart({...config, ZOOM_AUTO_ATTENDANCE_FROM:'2026-02-30'}), null);
    assert.equal(configuredZoomAttendanceStart(config), target.date);
    const beforeEnd = new Date('2026-11-16T13:59:59Z');
    const afterEnd = new Date('2026-11-16T14:11:00Z');
    assert.equal(approve.automatic(receipt.id, beforeEnd.getTime()), 'not-ready');
    failAudit = false;
    const runAutomatic = createZoomAutomaticAttendanceRunner(db, approve, target.date, error => {throw error;});
    createZoomAutomaticAttendanceRunner(db, approve, '2026-11-17', error => {throw error;})(afterEnd);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_class_attendance').get().n, 0);
    runAutomatic(beforeEnd);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_class_attendance').get().n, 0);
    runAutomatic(afterEnd);
    runAutomatic(afterEnd);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM test_attendance_audit').get().n, 1);
    db.exec('DELETE FROM student_class_attendance; DELETE FROM test_attendance_audit');
    delete schedule.zoomMinSessionPercent;
    runAutomatic(afterEnd);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_class_attendance').get().n, 0);
    failAudit = true;
    assert.equal(approve(receipt.id, {...expected, seconds: 6000}), 'changed');
    db.prepare('INSERT INTO course_attendance_excuses VALUES (?, ?)').run(10, 'editing');
    assert.equal(approve(receipt.id, expected), 'existing');
    db.prepare('DELETE FROM course_attendance_excuses').run();
    db.prepare('INSERT INTO student_class_attendance VALUES (?, ?, 0)').run(10, 'editing');
    assert.equal(approve(receipt.id, expected), 'existing');
    assert.equal(db.prepare('SELECT attended FROM student_class_attendance').get().attended, 0);
    db.prepare('DELETE FROM student_class_attendance').run();
    assert.throws(() => approve(receipt.id, expected), /Audit failed/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_class_attendance').get().n, 0);
    failAudit = false;
    assert.equal(approve(receipt.id, expected), 'created');
    assert.equal(approve(receipt.id, expected), 'existing');
    assert.equal(db.prepare('SELECT attended FROM student_class_attendance').get().attended, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM test_attendance_audit').get().n, 1);
    console.log('PASS: reviewed Zoom attendance, stale evidence, existing mark/exception protection, and atomic audit rollback');
    assert.equal(participants.verify(receipt.id, 10, 1).status, 'existing');
    assert.equal(participants.verify(receipt.id, 11, 1).status, 'conflict');
    assert.deepEqual(participants.resolve(receipt.id), {enrollmentId: 10, classId: 'editing'});
    const review = participants.review(receipt.id);
    assert.deepEqual(review.enrollments.map(item => item.id), [10, 11]);
    assert.deepEqual(review.participants.map(({id, enrollmentId}) => ({id, enrollmentId})), [{id: receipt.id, enrollmentId: 10}]);
    assert.equal(participants.revoke(receipt.id, 11, 'Incorrect identity', 2).status, 'conflict');
    assert.equal(participants.revoke(receipt.id, 10, ' ', 2).status, 'invalid');
    assert.equal(participants.revoke(receipt.id, 10, 'Incorrect identity', 2).status, 'revoked');
    assert.equal(participants.resolve(receipt.id), null);
    assert.deepEqual(db.prepare('SELECT enrollment_id, verified_by, revoked_by, reason FROM zoom_participant_revocations').get(),
      {enrollment_id: 10, verified_by: 1, revoked_by: 2, reason: 'Incorrect identity'});
    assert.equal(participants.verify(receipt.id, 10, 1).status, 'created');
    admitted = false;
    assert.equal(participants.resolve(receipt.id), null);
    admitted = true;
    db.prepare('UPDATE users SET is_active=0 WHERE id=1').run();
    assert.equal(participants.resolve(receipt.id), null);
    db.prepare('UPDATE users SET is_active=1 WHERE id=1').run();
    const other = structuredClone(event);
    other.payload.object.uuid = 'another-instance';
    assert.equal((await send(other)).status, 200);
    const otherReceipt = db.prepare('SELECT id FROM zoom_event_receipts WHERE meeting_instance=?').get('another-instance');
    assert.equal(store.resolve(otherReceipt.id), null);
    assert.equal(store.bind(otherReceipt.id, target, 1).status, 'conflict');
    assert.deepEqual(store.options(target.batchId, target.phaseId, target.date)[0].receipts.map(({id, bound}) => ({id, bound})), [{id: receipt.id, bound: true}]);
    schedule = {...schedule, slots: [{...schedule.slots[0], sessionChanges: [{status:'cancelled', originalDate:target.date}]}]};
    assert.equal(store.resolve(receipt.id), null);
    assert.equal(participants.resolve(receipt.id), null);
    assert.deepEqual(store.options(target.batchId, target.phaseId, target.date), []);
    assert.equal(participants.evidence(receipt.id), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM zoom_event_receipts WHERE status=?').get('unmatched').n,6);
    console.log('PASS: persisted binding, signed receipt matching, duplicate protection and cancellation invalidation');
    console.log('PASS: Zoom challenge, authenticated events, account scope, replay deduplication and unmatched queue');
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
