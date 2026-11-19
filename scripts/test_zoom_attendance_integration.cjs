const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict'), express = require('express'), jwt = require('jsonwebtoken');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfi-zoom-approval-'));
process.env.DATABASE_PATH = path.join(dir, 'test.sqlite');
process.env.JWT_SECRET = 'local-zoom-approval-test-only';
process.env.NODE_ENV = 'test';
(async () => {
  let db, server;
  try {
    const database = await import('../server/db/database.js');
    db = database.default;
    await database.initializeDatabase();
    const user = db.prepare("INSERT INTO users (username,email,password_hash,role,first_name,last_name,is_active,is_super_admin,token_version) VALUES (?,?, 'fixture',?, 'Test','User',1,?,1)");
    const actor = Number(user.run('zoom_admin','zoom-admin@example.test','admin',1).lastInsertRowid);
    const student = Number(user.run('zoom_student','zoom-student@example.test','student',0).lastInsertRowid);
    const regularAdmin = Number(user.run('zoom_admin2','zoom-admin2@example.test','admin',0).lastInsertRowid);
    const issue = (id) => {
      const sessionId = Number(db.prepare("INSERT INTO sessions (user_id,token_hash,expires_at) VALUES (?,'fixture',datetime('now','+1 hour'))").run(id).lastInsertRowid);
      return jwt.sign({id,sessionId,token_version:1,type:'access'},process.env.JWT_SECRET);
    };
    const bearer = issue(actor), restricted = issue(regularAdmin), studentBearer = issue(student);
    const date = '2026-11-16', classId = 'class_a';
    const definition = { basics:{name:'Zoom Workshop',type:'workshop',phaseCount:1}, completionPolicy:{}, phases:[
      {id:'phase_1',title:'Foundation',requirements:{zoomMinSessionPercent:50},classes:[{id:classId,title:'Online',mandatory:true}],assignments:[],exam:{enabled:false},routine:[
        {id:'slot-a',date,startTime:'18:00',endTime:'20:00',classId,meetingUrl:'https://zoom.us/j/123456789'}
      ]}
    ]};
    const def = Number(db.prepare("INSERT INTO course_definitions (slug,version,name,course_type,status,phase_count,definition_json,created_by,updated_by) VALUES ('zoom-workshop',1,'Zoom Workshop','workshop','published',1,?,?,?)").run(JSON.stringify(definition),actor,actor).lastInsertRowid);
    const batch = Number(db.prepare("INSERT INTO batches (batch_name,batch_number,course_name,status,course_definition_id) VALUES ('Zoom Batch','1','Zoom Workshop','active',?)").run(def).lastInsertRowid);
    const enrollmentId = Number(db.prepare("INSERT INTO student_course_enrollments (user_id,course_name,course_type,course_definition_id,batch_id) VALUES (?,'Zoom Workshop','workshop',?,?)").run(student,def,batch).lastInsertRowid);
    const crypto = require('node:crypto');
    const admin = await import('../server/routes/admin.js');
    const {createZoomWebhookRouter} = await import('../server/routes/zoom-webhook.js');
    const zoomMeetings = (await import('../server/routes/zoom-meetings.js')).default;
    process.env.ZOOM_CLIENT_ID = 'test-sdk-id';
    process.env.ZOOM_CLIENT_SECRET = 'isolated-test-sdk-secret';
    const webhook = {enabled:true,secret:'isolated-test-webhook-secret',accountId:'fixture-account'};
    const app = express();
    app.use('/api/zoom-webhook',createZoomWebhookRouter(db,webhook));
    app.use(express.json());
    app.use('/api/admin',admin.default);
    app.use('/api/zoom-meetings',zoomMeetings);
    server = await new Promise(resolve => {const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base = 'http://127.0.0.1:'+server.address().port;
    const joinResponse = await fetch(base+'/api/zoom-meetings/join',{
      method:'POST', headers:{Authorization:'Bearer '+studentBearer,'Content-Type':'application/json'},
      body:JSON.stringify({batchId:batch,phaseId:'phase_1',slotId:'slot-a',date})
    });
    assert.equal(joinResponse.status,200,await joinResponse.clone().text());
    const joinData = await joinResponse.json();
    assert.equal(joinData.meetingNumber,'123456789');
    assert.equal(jwt.verify(joinData.signature,process.env.ZOOM_CLIENT_SECRET,{algorithms:['HS256']}).role,0);
    const adminJoinResponse = await fetch(base+'/api/zoom-meetings/join',{
      method:'POST', headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
      body:JSON.stringify({batchId:batch,phaseId:'phase_1',slotId:'slot-a',date})
    });
    assert.equal(adminJoinResponse.status,200,await adminJoinResponse.clone().text());
    const adminJoinData = await adminJoinResponse.json();
    assert.equal(adminJoinData.meetingNumber,'123456789');
    assert.equal(jwt.verify(adminJoinData.signature,process.env.ZOOM_CLIENT_SECRET,{algorithms:['HS256']}).role,0);
    const restrictedJoinResponse = await fetch(base+'/api/zoom-meetings/join',{
      method:'POST', headers:{Authorization:'Bearer '+restricted,'Content-Type':'application/json'},
      body:JSON.stringify({batchId:batch,phaseId:'phase_1',slotId:'slot-a',date})
    });
    assert.equal(restrictedJoinResponse.status,403);

    async function sendEvent(type, timestamp, account = webhook.accountId) {
      const body = JSON.stringify({event:`meeting.participant_${type === 'join' ? 'joined' : 'left'}`,
        event_ts: Date.parse(timestamp),payload:{account_id:account,object:{id:123456789,uuid:'instance',
          participant:{user_id:'participant',[`${type}_time`]:timestamp}}}});
      const requestTime = String(Math.floor(Date.now()/1000));
      const signature = 'v0='+crypto.createHmac('sha256',webhook.secret).update(`v0:${requestTime}:${body}`).digest('hex');
      return fetch(base+'/api/zoom-webhook',{method:'POST',headers:{'content-type':'application/json',
        'x-zm-request-timestamp':requestTime,'x-zm-signature':signature},body});
    }
    assert.equal((await sendEvent('join',date+'T12:00:00.000Z','wrong-account')).status,403);
    assert.equal((await sendEvent('leave',date+'T13:00:00.000Z')).status,200);
    assert.equal((await sendEvent('join',date+'T12:00:00.000Z')).status,200);
    assert.equal((await sendEvent('join',date+'T12:00:00.000Z')).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM zoom_event_receipts').get().n,2);
    const receipt = db.prepare("SELECT id FROM zoom_event_receipts WHERE event_type='meeting.participant_joined'").get().id;
    const call = async (endpoint, method, body, token = bearer) => {
      const response = await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/zoom-event-receipts/'+receipt+'/'+endpoint,{
        method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined
      });
      return [response.status, await response.json()];
    };
    assert.equal((await call('class-binding','PUT',{batchId:batch,phaseId:'phase_1',slotId:'slot-a',classId,date}))[0],201);
    assert.equal((await call('participant-verification','PUT',{enrollmentId,identityConfirmed:true}))[0],201);
    const [code, result] = await call('attendance-evidence','GET');
    assert.equal(code,200);
    assert.deepEqual(result.evidence,{seconds:3600,scheduledSeconds:7200,incomplete:false,policy:{minimumPercent:50,minimumSeconds:3600,meetsMinimum:true}});

    assert.equal((await call('participant-review','GET',null,restricted))[0],403);
    assert.equal(admin.createConfiguredZoomAttendanceJob({}),null);
    const run = admin.createConfiguredZoomAttendanceJob({ZOOM_AUTO_ATTENDANCE_ENABLED:'true',ZOOM_WEBHOOK_ENABLED:'true',
      ZOOM_WEBHOOK_SECRET:webhook.secret,ZOOM_ACCOUNT_ID:webhook.accountId,ZOOM_AUTO_ATTENDANCE_FROM:date});
    run(new Date(date+'T13:59:59Z'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_class_attendance').get().n,0);
    run(new Date(date+'T14:01:00Z'));
    run(new Date(date+'T14:01:00Z'));
    assert.deepEqual(db.prepare('SELECT attended,updated_by FROM student_class_attendance WHERE enrollment_id=? AND class_id=?').get(enrollmentId,classId),{attended:1,updated_by:null});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action='zoom_attendance_automatic' AND actor_id IS NULL AND target_user_id=?").get(student).n,1);
    assert.ok(db.prepare('SELECT 1 FROM student_phase_results WHERE enrollment_id=? AND phase_id=?').get(enrollmentId,'phase_1'));
    console.log('PASS: local Zoom integration from authorized join and signed provider fixtures through automatic attendance, progress, and audit');
  } finally {
    if (server) await new Promise(resolve=>server.close(resolve));
    if (db) db.close();
    for (const file of ['test.sqlite','test.sqlite-wal','test.sqlite-shm']) fs.rmSync(path.join(dir,file),{force:true});
    fs.rmdirSync(dir);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
