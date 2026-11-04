'use strict';
/**
 * scripts/test_real_express_routes.cjs
 *
 * Verifies the actual Express routes:
 * - server/routes/course-definitions.js
 * - server/routes/batches.js
 * - server/routes/admin.js (PUT /api/admin/students/:id)
 * over real HTTP requests using an isolated database via process.env.DATABASE_PATH.
 *
 * Covers:
 * 1. Reason Length Validation (HTTP 400)
 * 2. Save Batch Routine Override (HTTP 200, Canonical ID resolution)
 * 3. Read-back via Batches Route
 * 4. Atomic Revert Action (HTTP 200, restores baseline)
 * 5. Reordered Phases Isolation & Non-Overlapping Revert:
 *    phases: [{ id: 'phase_2', phaseIndex: 2 }, { id: 'phase_1', phaseIndex: 1 }]
 *    Reverting phase_1 NEVER modifies or deletes phase_2 overrides or audit attribution!
 * 6. Custom Non-Numeric Phase Identifiers ('pre_prod', 'prod', 'post_prod')
 * 7. Ambiguous Phase Identifier Rejection (HTTP 400)
 * 8. Full Payment Lifecycle via Real Payment Route (PUT /api/admin/students/:id):
 *    3-phase course, partial payment with installments, remaining dues,
 *    discount calculation, final payment, and dynamic progression/certificate eligibility!
 */

const path = require('path');
const fs = require('fs');

// Set isolated database path BEFORE any server module imports
const testDbPath = path.resolve(__dirname, '../server/test_real_express_routes.sqlite');

function cleanupDbFiles() {
  for (const ext of ['', '-wal', '-shm']) {
    const p = testDbPath + ext;
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore unlink error */ }
    }
  }
}
cleanupDbFiles();

process.env.DATABASE_PATH = testDbPath;
process.env.JWT_SECRET = 'test-jwt-secret-bfi-classroom-2026-very-secure';

const jwt = require('jsonwebtoken');
const express = require('express');
const http = require('http');
const assert = require('assert');

// 30-second bounded execution safety watchdog
const watchdog = setTimeout(() => {
  console.error('❌ FATAL: test_real_express_routes execution watchdog triggered after 30 seconds');
  cleanupDbFiles();
  process.exit(1);
}, 30000);
watchdog.unref();

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const signal = options.signal || AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...options, signal });
  } catch (err) {
    console.error(`❌ HTTP request failed or timed out (${timeoutMs}ms): ${options.method || 'GET'} ${url} - ${err.message}`);
    throw err;
  }
}

async function run() {
  const { default: db, initializeDatabase } = await import('../server/db/database.js');
  const { getJwtSecret } = await import('../server/config/security.js');
  const { 
    getCanonicalPhaseInfo, 
    resolvePhaseRoutine, 
    getEnrollmentProgressSync, 
    updateDefinedProgressAtomic, 
    admitStudentToPhase 
  } = await import('../server/services/courseProgressService.js');
  const { resolvePhaseFee } = await import('../server/utils/feeResolver.js');

  initializeDatabase();
  console.log('✅ Real application schema initialized via initializeDatabase()');

  // Seed users in the isolated database with token_version = 1
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version)
    VALUES (1, 'superadmin', 'superadmin@bfi.edu', 'hash', 'admin', 'Super', 'Admin', 1, 1, 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version)
    VALUES (2, 'batchadmin', 'batchadmin@bfi.edu', 'hash', 'admin', 'Batch', 'Admin', 1, 0, 1)
  `).run();

  // Seed permissions
  const permissions = ['batches:edit', 'batches:view', 'courses:edit', 'students:edit', 'students:view', 'students:academic_records'];
  for (const perm of permissions) {
    db.prepare('INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (1, ?)').run(perm);
    db.prepare('INSERT OR IGNORE INTO admin_permissions (user_id, permission) VALUES (2, ?)').run(perm);
  }

  try {
    db.prepare('INSERT OR REPLACE INTO super_admin_users (user_id, granted_by) VALUES (1, 1)').run();
  } catch { /* empty */ }

  // Seed active sessions in real application 'sessions' table
  try {
    db.prepare(`
      INSERT OR REPLACE INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
      VALUES (101, 2, 'dummy-hash-2', '127.0.0.1', 'test-agent', datetime('now', '+1 hour'))
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
      VALUES (102, 1, 'dummy-hash-1', '127.0.0.1', 'test-agent', datetime('now', '+1 hour'))
    `).run();
  } catch (err) {
    console.warn('Could not seed sessions:', err.message);
  }

  // Seed course definition and batch
  const defJson = {
    basics: { name: 'Script Writing Workshop-2026', type: 'workshop', phaseCount: 1 },
    phases: [
      {
        id: 'phase_1',
        phaseIndex: 1,
        title: 'Phase 1: Story Structure',
        classCount: 1,
        routine: [
          { weekday: 'Saturday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }
        ],
        classes: [
          { id: 'cls_1', title: 'Part 01: Character Archetypes', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }
        ]
      }
    ]
  };

  const defRes = db.prepare(`
    INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
    VALUES ('script-writing-workshop-2026', 1, 'Script Writing Workshop-2026', 'workshop', 'published', 1, ?, 1, 1)
  `).run(JSON.stringify(defJson));
  const courseDefId = defRes.lastInsertRowid;

  db.prepare(`
    INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
    VALUES (100082, NULL, '1st Batch', '01', 'Script Writing Workshop-2026', ?, 1)
  `).run(courseDefId);

  function createValidToken(user) {
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      is_super_admin: user.is_super_admin ? 1 : 0,
      token_version: 1,
      type: 'access'
    };
    if (user.role === 'admin') {
      payload.sessionId = user.id === 2 ? 101 : 102;
    }
    return jwt.sign(payload, getJwtSecret(), { expiresIn: '1h' });
  }

  const batchAdminToken = createValidToken({ id: 2, username: 'batchadmin', role: 'admin', is_super_admin: 0 });
  const superAdminToken = createValidToken({ id: 1, username: 'superadmin', role: 'admin', is_super_admin: 1 });

  // Import routers
  const { default: courseDefRouter } = await import('../server/routes/course-definitions.js');
  const { default: batchesRouter } = await import('../server/routes/batches.js');
  const { default: adminRouter } = await import('../server/routes/admin.js');
  const { default: certificationRouter } = await import('../server/routes/certification.js');

  const app = express();
  app.use(express.json());
  app.use('/api/course-definitions', courseDefRouter);
  app.use('/api/admin/batches', batchesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/certification', certificationRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`✅ Real Express test server running on ${baseUrl}`);

  try {
    // -------------------------------------------------------------
    // HTTP TEST 1: Reason Length Validation on Real Route
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 1: Reason Length Validation ---');
    const resShortReason = await fetchWithTimeout(`${baseUrl}/api/course-definitions/${courseDefId}/routine`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${batchAdminToken}`
      },
      body: JSON.stringify({
        phase_id: 'phase_1',
        batch_id: 100082,
        routine: [],
        reason: 'ok' // < 3 characters
      })
    });

    const jsonShort = await resShortReason.json();
    assert.strictEqual(resShortReason.status, 400, 'HTTP route must return 400 for reason < 3 chars');
    assert.match(jsonShort.error, /at least 3 characters/i);
    console.log(`✅ 1.1 Real route rejected short reason with HTTP 400: "${jsonShort.error}"`);

    // -------------------------------------------------------------
    // HTTP TEST 2: Save Batch Routine Override via Real Route
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 2: Save Batch Routine Override ---');
    const resSave = await fetchWithTimeout(`${baseUrl}/api/course-definitions/${courseDefId}/routine`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${batchAdminToken}`
      },
      body: JSON.stringify({
        phase_id: 'p_1', // Using alias 'p_1' to test canonical resolution
        batch_id: 100082,
        routine: [
          { date: '2026-08-25', weekday: 'Tuesday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }
        ],
        reason: 'Adjusted shooting and holiday schedule for Batch 01'
      })
    });

    assert.strictEqual(resSave.status, 200, 'HTTP route must return 200 on valid batch override');
    const jsonSave = await resSave.json();
    assert.strictEqual(jsonSave.phase_id, 'phase_1', 'Saved phase_id must be canonical phase_1');
    console.log('✅ 2.1 Batch routine saved via real route under canonical ID: phase_1');

    // -------------------------------------------------------------
    // HTTP TEST 3: Read back via GET /api/admin/batches/:id
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 3: Read-back via Batches Route ---');
    const resGetBatch = await fetchWithTimeout(`${baseUrl}/api/admin/batches/100082`, {
      headers: {
        'Authorization': `Bearer ${batchAdminToken}`
      }
    });

    assert.strictEqual(resGetBatch.status, 200);
    const jsonBatch = await resGetBatch.json();
    const batchPhases = jsonBatch.course_definition?.definition?.phases || [];
    assert.strictEqual(batchPhases.length, 1);
    assert.strictEqual(batchPhases[0].id, 'phase_1', 'Batch phase ID must be canonical phase_1');
    assert.strictEqual(batchPhases[0].routineSource, 'batch_override');
    assert.strictEqual(batchPhases[0].routine.length, 1);
    assert.strictEqual(batchPhases[0].routine[0].platform, 'Zoom');
    assert.strictEqual(batchPhases[0].routine[0].startTime, '19:00');
    assert.strictEqual(batchPhases[0].routine[0].endTime, '21:00');
    assert.strictEqual(batchPhases[0].routine[0].date, '2026-08-25');
    console.log('✅ 3.1 Real batches route successfully resolved batch override with Zoom and 19:00-21:00 defaults');

    // -------------------------------------------------------------
    // HTTP TEST 4: Atomic Revert Action via Real Route
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 4: Atomic Revert Action ---');
    const resRevert = await fetchWithTimeout(`${baseUrl}/api/course-definitions/${courseDefId}/routine`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${batchAdminToken}`
      },
      body: JSON.stringify({
        action: 'revert',
        phase_id: 'phase_1',
        batch_id: 100082,
        reason: 'Restoring back to original course template'
      })
    });

    const jsonRevert = await resRevert.json();
    assert.strictEqual(resRevert.status, 200);
    assert.strictEqual(jsonRevert.reverted, true);
    assert.strictEqual(jsonRevert.effectiveSource, 'definition_baseline');
    assert.strictEqual(jsonRevert.effectiveRoutine.length, 1);
    assert.strictEqual(jsonRevert.effectiveRoutine[0].weekday, 'Saturday');
    console.log('✅ 4.1 Revert action cleared batch override and restored definition baseline via real route');

    // Verify read-back after revert via batches route
    const resGetAfterRevert = await fetchWithTimeout(`${baseUrl}/api/admin/batches/100082`, {
      headers: { 'Authorization': `Bearer ${batchAdminToken}` }
    });
    const jsonBatchAfterRevert = await resGetAfterRevert.json();
    const phaseAfterRevert = jsonBatchAfterRevert.course_definition?.definition?.phases[0];
    assert.strictEqual(phaseAfterRevert.routineSource, 'definition_baseline');
    assert.strictEqual(phaseAfterRevert.routine[0].weekday, 'Saturday');
    console.log('✅ 4.2 Batches route confirms baseline restoration after revert');

    // -------------------------------------------------------------
    // HTTP TEST 5: Reordered Phases Isolation & Non-Overlapping Revert
    // (Addresses Codex Finding 1 directly on the real Express route)
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 5: Reordered Phases Isolation & Non-Overlapping Revert ---');
    // Seed reordered course definition: phase_2 is first in array (pos=1), phase_1 is second in array (pos=2)
    const reorderedDefJson = {
      basics: { name: 'Reordered Masterclass', type: 'workshop', phaseCount: 2 },
      phases: [
        {
          id: 'phase_2',
          phaseIndex: 2,
          title: 'Phase 2: Post-Production',
          classCount: 1,
          routine: [{ weekday: 'Sunday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }]
        },
        {
          id: 'phase_1',
          phaseIndex: 1,
          title: 'Phase 1: Pre-Production',
          classCount: 1,
          routine: [{ weekday: 'Saturday', startTime: '19:00', endTime: '21:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }]
        }
      ]
    };

    const reorderedDefRes = db.prepare(`
      INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
      VALUES ('reordered-masterclass', 1, 'Reordered Masterclass', 'workshop', 'published', 2, ?, 1, 1)
    `).run(JSON.stringify(reorderedDefJson));
    const reorderedDefId = reorderedDefRes.lastInsertRowid;
    const reorderedBatchId = 200001;

    db.prepare(`
      INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
      VALUES (?, 'reordered-batch-01', '1st Batch', '01', 'Reordered Masterclass', ?, 1)
    `).run(reorderedBatchId, reorderedDefId);

    // Save batch override for phase_2
    const resSaveP2 = await fetchWithTimeout(`${baseUrl}/api/course-definitions/${reorderedDefId}/routine`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${batchAdminToken}` },
      body: JSON.stringify({
        phase_id: 'phase_2',
        batch_id: reorderedBatchId,
        routine: [{ weekday: 'Sunday', startTime: '20:00', endTime: '22:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }],
        reason: 'Override for Phase 2 Sunday night'
      })
    });
    assert.strictEqual(resSaveP2.status, 200);
    const jsonSaveP2 = await resSaveP2.json();
    assert.strictEqual(jsonSaveP2.phase_id, 'phase_2');

    // Save batch override for phase_1
    const resSaveP1 = await fetchWithTimeout(`${baseUrl}/api/course-definitions/${reorderedDefId}/routine`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${batchAdminToken}` },
      body: JSON.stringify({
        phase_id: 'phase_1',
        batch_id: reorderedBatchId,
        routine: [{ weekday: 'Saturday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }],
        reason: 'Override for Phase 1 Saturday afternoon'
      })
    });
    assert.strictEqual(resSaveP1.status, 200);
    const jsonSaveP1 = await resSaveP1.json();
    assert.strictEqual(jsonSaveP1.phase_id, 'phase_1');

    // Check database has both overrides preserved independently
    const rowsBeforeRevert = db.prepare('SELECT phase_id, routine_json FROM course_routine_overrides WHERE course_definition_id = ? AND batch_id = ?').all(reorderedDefId, reorderedBatchId);
    assert.strictEqual(rowsBeforeRevert.length, 2, 'Must have exactly 2 override rows');
    const p1Row = rowsBeforeRevert.find(r => r.phase_id === 'phase_1');
    const p2Row = rowsBeforeBeforeRevert => rowsBeforeRevert.find(r => r.phase_id === 'phase_2');
    assert.ok(p1Row, 'Phase 1 override must exist');
    assert.ok(rowsBeforeRevert.find(r => r.phase_id === 'phase_2'), 'Phase 2 override must exist');

    // Revert phase_1 ONLY via real route
    const resRevertP1 = await fetchWithTimeout(`${baseUrl}/api/course-definitions/${reorderedDefId}/routine`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${batchAdminToken}` },
      body: JSON.stringify({
        action: 'revert',
        phase_id: 'phase_1',
        batch_id: reorderedBatchId,
        reason: 'Reverting phase 1 only back to template'
      })
    });
    assert.strictEqual(resRevertP1.status, 200);
    const jsonRevertP1 = await resRevertP1.json();
    assert.strictEqual(jsonRevertP1.reverted, true);
    assert.strictEqual(jsonRevertP1.phase_id, 'phase_1');

    // CRITICAL SECURITY ASSERTION: Phase 2 override was NOT deleted or corrupted!
    const rowsAfterRevert = db.prepare('SELECT phase_id, routine_json FROM course_routine_overrides WHERE course_definition_id = ? AND batch_id = ?').all(reorderedDefId, reorderedBatchId);
    assert.strictEqual(rowsAfterRevert.length, 1, 'Only phase_1 must have been deleted; phase_2 must remain intact!');
    assert.strictEqual(rowsAfterRevert[0].phase_id, 'phase_2', 'Remaining override must be strictly phase_2');

    // Audit attribution check
    const p1Audit = db.prepare('SELECT * FROM course_routine_audits WHERE course_definition_id = ? AND batch_id = ? AND phase_id = ? ORDER BY id DESC LIMIT 1').get(reorderedDefId, reorderedBatchId, 'phase_1');
    assert.ok(p1Audit, 'Audit record for phase_1 revert must exist');
    assert.strictEqual(p1Audit.phase_id, 'phase_1', 'Audit attribution must belong strictly to phase_1');
    console.log('✅ 5.1 Reordered phases isolation confirmed: Reverting phase_1 preserves phase_2 override and audits');

    // -------------------------------------------------------------
    // HTTP TEST 6: Custom Phase Identifiers ('pre_prod', 'prod', 'post_prod')
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 6: Custom Phase Identifiers ---');
    const customDefJson = {
      basics: { name: 'Indie Film Lab', type: 'workshop', phaseCount: 3 },
      phases: [
        { id: 'pre_prod', title: 'Pre-Production Stage', routine: [{ weekday: 'Monday', startTime: '19:00', endTime: '21:00' }] },
        { id: 'prod', title: 'Production Stage', routine: [{ weekday: 'Wednesday', startTime: '19:00', endTime: '21:00' }] },
        { id: 'post_prod', title: 'Post-Production Stage', routine: [{ weekday: 'Friday', startTime: '19:00', endTime: '21:00' }] }
      ]
    };

    const customDefRes = db.prepare(`
      INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
      VALUES ('indie-film-lab', 1, 'Indie Film Lab', 'workshop', 'published', 3, ?, 1, 1)
    `).run(JSON.stringify(customDefJson));
    const customDefId = customDefRes.lastInsertRowid;
    const customBatchId = 200002;

    db.prepare(`
      INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
      VALUES (?, 'ifl-batch-01', '1st Batch', '01', 'Indie Film Lab', ?, 1)
    `).run(customBatchId, customDefId);

    // Save batch override for 'prod'
    const resSaveCustom = await fetchWithTimeout(`${baseUrl}/api/course-definitions/${customDefId}/routine`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${batchAdminToken}` },
      body: JSON.stringify({
        phase_id: 'prod',
        batch_id: customBatchId,
        routine: [{ weekday: 'Wednesday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka', deliveryMode: 'recorded', category: 'theory', platform: 'Zoom' }],
        reason: 'Adjusted prod routine for shooting dates'
      })
    });
    assert.strictEqual(resSaveCustom.status, 200);
    const jsonSaveCustom = await resSaveCustom.json();
    assert.strictEqual(jsonSaveCustom.phase_id, 'prod', 'Custom string phase ID must be canonical');

    // Read back via batches route
    const resGetCustomBatch = await fetchWithTimeout(`${baseUrl}/api/admin/batches/${customBatchId}`, {
      headers: { 'Authorization': `Bearer ${batchAdminToken}` }
    });
    const jsonCustomBatch = await resGetCustomBatch.json();
    const cPhases = jsonCustomBatch.course_definition?.definition?.phases || [];
    assert.strictEqual(cPhases[0].id, 'pre_prod');
    assert.strictEqual(cPhases[0].routineSource, 'definition_baseline');
    assert.strictEqual(cPhases[1].id, 'prod');
    assert.strictEqual(cPhases[1].routineSource, 'batch_override');
    assert.strictEqual(cPhases[2].id, 'post_prod');
    assert.strictEqual(cPhases[2].routineSource, 'definition_baseline');
    console.log('✅ 6.1 Custom phase identifiers (pre_prod, prod, post_prod) resolved and isolated successfully');

    // -------------------------------------------------------------
    // HTTP TEST 7: Ambiguous Identifier Rejection (HTTP 400)
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 7: Ambiguous Identifier Rejection ---');
    // Create definition with duplicate explicit phase IDs
    const ambiguousDefJson = {
      basics: { name: 'Ambiguous Course', type: 'workshop', phaseCount: 2 },
      phases: [
        { id: 'dup_phase', title: 'Phase One', routine: [{ weekday: 'Saturday', startTime: '19:00', endTime: '21:00' }] },
        { id: 'dup_phase', title: 'Phase Two', routine: [{ weekday: 'Sunday', startTime: '19:00', endTime: '21:00' }] }
      ]
    };
    const ambigDefRes = db.prepare(`
      INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
      VALUES ('ambiguous-course', 1, 'Ambiguous Course', 'workshop', 'published', 2, ?, 1, 1)
    `).run(JSON.stringify(ambiguousDefJson));
    const ambigDefId = ambigDefRes.lastInsertRowid;
    db.prepare(`
      INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
      VALUES (200003, 'ambig-batch-01', '1st Batch', '01', 'Ambiguous Course', ?, 1)
    `).run(ambigDefId);

    const resAmbig = await fetchWithTimeout(`${baseUrl}/api/course-definitions/${ambigDefId}/routine`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${batchAdminToken}` },
      body: JSON.stringify({
        phase_id: 'dup_phase',
        batch_id: 200003,
        routine: [{ weekday: 'Saturday', startTime: '19:00', endTime: '21:00' }],
        reason: 'Trying to update duplicate phase'
      })
    });
    assert.strictEqual(resAmbig.status, 400, 'Must return HTTP 400 on ambiguous phase identifier');
    const jsonAmbig = await resAmbig.json();
    assert.match(jsonAmbig.error, /Ambiguous phase identifier/i);
    console.log(`✅ 7.1 Ambiguous phase mapping rejected with HTTP 400: "${jsonAmbig.error}"`);

    // -------------------------------------------------------------
    // HTTP TEST 8: Full Real Payment Route Lifecycle (PUT /api/admin/students/:id)
    // & Academic Progression
    // (Addresses Codex Finding 2 using the actual payment routes and services)
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 8: Full Real Payment Route Lifecycle & Progression ---');

    // 8.1 Seed 3-Phase Course Definition
    const diplomaDefJson = {
      basics: { name: 'Directing Diploma 3-Phase', type: 'diploma', phaseCount: 3 },
      completionPolicy: {
        certificateEligibility: {
          allRequiredPhasesPassed: true,
          requireFeesPaid: true,
          minOverallAttendance: 50
        },
        phaseProgression: {
          sequentialProgression: true,
          requirePreviousPhasePassed: true,
          requirePreviousPhaseFeesPaid: true
        }
      },
      phases: [
        {
          id: 'phase_1',
          phaseIndex: 1,
          title: 'Phase 1: Pre-Visualisation',
          feeAmount: 5000,
          classCount: 1,
          routine: [{ weekday: 'Saturday', startTime: '19:00', endTime: '21:00' }],
          classes: [{ id: 'cls_d1', title: 'Storyboarding', mandatory: true }],
          assignments: [{ id: 'asg_d1', title: 'Storyboard Book', passMarks: 10, maxMarks: 20 }],
          exam: { enabled: true, title: 'Phase 1 Exam', passMarks: 40, maxMarks: 80 }
        },
        {
          id: 'phase_2',
          phaseIndex: 2,
          title: 'Phase 2: Principal Photography',
          feeAmount: 5000,
          classCount: 1,
          routine: [{ weekday: 'Sunday', startTime: '19:00', endTime: '21:00' }],
          classes: [{ id: 'cls_d2', title: 'Blocking & Directing Actors', mandatory: true }],
          assignments: [{ id: 'asg_d2', title: 'Short Scene Directing', passMarks: 10, maxMarks: 20 }],
          exam: { enabled: true, title: 'Phase 2 Exam', passMarks: 40, maxMarks: 80 }
        },
        {
          id: 'phase_3',
          phaseIndex: 3,
          title: 'Phase 3: Post & Festival Release',
          feeAmount: 5000,
          classCount: 1,
          routine: [{ weekday: 'Monday', startTime: '19:00', endTime: '21:00' }],
          classes: [{ id: 'cls_d3', title: 'Colour Grade & Sound Mix', mandatory: true }],
          assignments: [{ id: 'asg_d3', title: 'Final Cut Submission', passMarks: 10, maxMarks: 20 }],
          exam: { enabled: true, title: 'Graduation Defense', passMarks: 40, maxMarks: 80 }
        }
      ]
    };

    const diplomaDefRes = db.prepare(`
      INSERT INTO course_definitions (slug, version, name, course_type, status, phase_count, definition_json, created_by, updated_by)
      VALUES ('directing-diploma-3-phase', 1, 'Directing Diploma 3-Phase', 'diploma', 'published', 3, ?, 1, 1)
    `).run(JSON.stringify(diplomaDefJson));
    const diplomaDefId = diplomaDefRes.lastInsertRowid;
    const diplomaBatchId = 300001;

    db.prepare(`
      INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
      VALUES (?, 'dd-batch-01', '1st Batch', '01', 'Directing Diploma 3-Phase', ?, 1)
    `).run(diplomaBatchId, diplomaDefId);

    // Seed student user (id: 50) and profile
    const studentUserId = 50;
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version)
      VALUES (?, 'jamil', 'jamil@bfi.edu', 'hash', 'student', 'Jamil', 'Hasan', 1, 0, 1)
    `).run(studentUserId);

    db.prepare(`
      INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number)
      VALUES (?, 'Jamil Hasan', 'BFI01012026', '01')
    `).run(studentUserId);

    // Initial student enrollment via real route: PUT /api/admin/students/:id
    // Phase 1: Partial payment of 2500 out of 5000 (Installments)
    const initialFeePayload = {
      'Directing Diploma 3-Phase': {
        batch_id: diplomaBatchId,
        phase1: {
          full_fee: 5000,
          discount: 0,
          amount_paid: 2500,
          status: 'partial paid',
          installments: [
            { id: 1, amount: 2500, date: '2026-08-01', method: 'bKash', status: 'paid' },
            { id: 2, amount: 2500, date: '2026-09-01', method: 'bKash', status: 'pending' }
          ]
        },
        phase2: {
          full_fee: 5000,
          amount_paid: 0,
          status: 'unpaid'
        },
        phase3: {
          full_fee: 5000,
          amount_paid: 0,
          status: 'unpaid'
        }
      }
    };

    console.log('--- 8.1 Execute initial enrollment with Phase 1 installment payment via PUT /api/admin/students/:id ---');
    const resEnroll = await fetchWithTimeout(`${baseUrl}/api/admin/students/${studentUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${superAdminToken}` },
      body: JSON.stringify({
        firstName: 'Jamil',
        lastName: 'Hasan',
        email: 'jamil@bfi.edu',
        username: 'jamil',
        batchNumber: '01',
        courses: ['Directing Diploma 3-Phase'],
        course_fees: initialFeePayload
      })
    });
    assert.strictEqual(resEnroll.status, 200, 'Student update route must succeed');

    const enrollmentRow = db.prepare('SELECT id, fee_details FROM student_course_enrollments WHERE user_id = ? AND course_name = ?').get(studentUserId, 'Directing Diploma 3-Phase');
    assert.ok(enrollmentRow, 'Enrollment must exist in database');
    const enrId = enrollmentRow.id;

    // Verify Phase 1 fee accounting via resolvePhaseFee
    const p1AcctInitial = resolvePhaseFee({
      feeDetailsRaw: enrollmentRow.fee_details,
      phaseIndex: 0,
      courseDefId: diplomaDefId,
      customDb: db
    });
    assert.strictEqual(p1AcctInitial.grossFee, 5000);
    assert.strictEqual(p1AcctInitial.cashCollected, 2500);
    assert.strictEqual(p1AcctInitial.remainingDue, 2500);
    assert.strictEqual(p1AcctInitial.status, 'Partial');
    assert.strictEqual(p1AcctInitial.isPaid, false, 'Partial payment must not mark phase fee as fully paid');
    console.log('✅ 8.1 Phase 1 partial payment verified: ৳2,500 collected, ৳2,500 due, status: Partial Paid');

    // 8.2 Pay remaining installment of Phase 1 via PUT /api/admin/students/:id
    console.log('--- 8.2 Clear Phase 1 remaining dues via PUT /api/admin/students/:id ---');
    const phase1PaidPayload = JSON.parse(JSON.stringify(initialFeePayload));
    phase1PaidPayload['Directing Diploma 3-Phase'].phase1.amount_paid = 5000;
    phase1PaidPayload['Directing Diploma 3-Phase'].phase1.status = 'paid';
    phase1PaidPayload['Directing Diploma 3-Phase'].phase1.installments[1].status = 'paid';

    const resP1Pay = await fetchWithTimeout(`${baseUrl}/api/admin/students/${studentUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${superAdminToken}` },
      body: JSON.stringify({
        firstName: 'Jamil',
        lastName: 'Hasan',
        email: 'jamil@bfi.edu',
        username: 'jamil',
        batchNumber: '01',
        courses: ['Directing Diploma 3-Phase'],
        course_fees: phase1PaidPayload
      })
    });
    assert.strictEqual(resP1Pay.status, 200);

    const enrRowP1Paid = db.prepare('SELECT fee_details FROM student_course_enrollments WHERE id = ?').get(enrId);
    const p1AcctCleared = resolvePhaseFee({
      feeDetailsRaw: enrRowP1Paid.fee_details,
      phaseIndex: 0,
      courseDefId: diplomaDefId,
      customDb: db
    });
    assert.strictEqual(p1AcctCleared.grossFee, 5000);
    assert.strictEqual(p1AcctCleared.cashCollected, 5000);
    assert.strictEqual(p1AcctCleared.remainingDue, 0);
    assert.strictEqual(p1AcctCleared.isPaid, true);
    assert.strictEqual(p1AcctCleared.status, 'Paid Full');
    console.log('✅ 8.2 Phase 1 dues cleared: ৳5,000 paid in full, remainingDue: 0, status: Paid');

    // Complete Phase 1 Academic Requirements via updateDefinedProgressAtomic
    await updateDefinedProgressAtomic(
      enrId,
      {
        attendance: [{ class_id: 'cls_d1', attended: 1 }],
        assignments: [{ assignment_id: 'asg_d1', marks: 18, submission_status: 'graded' }],
        exam_marks: [{ phase_id: 'phase_1', examMarks: 70 }],
        updatedBy: 1
      },
      db
    );

    const progP1Done = getEnrollmentProgressSync(enrId, db);
    assert.strictEqual(progP1Done.phases[0].isPassed, true, 'Phase 1 must be passed');
    assert.strictEqual(progP1Done.phases[1].isLocked, false, 'Phase 2 unlocks because Phase 1 is passed & paid');

    // Admit to Phase 2
    await admitStudentToPhase(enrId, 2, db, { batchId: diplomaBatchId, onCommitAudit: () => {} });

    // 8.3 Pay Phase 2 with 10% Discount via PUT /api/admin/students/:id
    console.log('--- 8.3 Pay Phase 2 with 10% discount via PUT /api/admin/students/:id ---');
    const phase2PaidPayload = JSON.parse(JSON.stringify(phase1PaidPayload));
    phase2PaidPayload['Directing Diploma 3-Phase'].phase2 = {
      full_fee: 5000,
      discount: '10%',
      amount_paid: 4500, // 5000 - 500 = 4500
      status: 'paid',
      installments: [{ id: 1, amount: 4500, date: '2026-10-01', method: 'bKash', status: 'paid' }]
    };

    const resP2Pay = await fetchWithTimeout(`${baseUrl}/api/admin/students/${studentUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${superAdminToken}` },
      body: JSON.stringify({
        firstName: 'Jamil',
        lastName: 'Hasan',
        email: 'jamil@bfi.edu',
        username: 'jamil',
        batchNumber: '01',
        courses: ['Directing Diploma 3-Phase'],
        course_fees: phase2PaidPayload
      })
    });
    assert.strictEqual(resP2Pay.status, 200);

    const enrRowP2Paid = db.prepare('SELECT fee_details FROM student_course_enrollments WHERE id = ?').get(enrId);
    const p2Acct = resolvePhaseFee({
      feeDetailsRaw: enrRowP2Paid.fee_details,
      phaseIndex: 1,
      courseDefId: diplomaDefId,
      customDb: db
    });
    assert.strictEqual(p2Acct.grossFee, 5000);
    assert.strictEqual(p2Acct.discountAmount, 500);
    assert.strictEqual(p2Acct.netPayable, 4500);
    assert.strictEqual(p2Acct.cashCollected, 4500);
    assert.strictEqual(p2Acct.remainingDue, 0);
    assert.strictEqual(p2Acct.isPaid, true);
    console.log('✅ 8.3 Phase 2 discount verified: Gross ৳5,000, 10% discount (-৳500), Net ৳4,500, Dues: 0');

    // Complete Phase 2 Academic Requirements & Admit to Phase 3
    await updateDefinedProgressAtomic(
      enrId,
      {
        attendance: [{ class_id: 'cls_d2', attended: 1 }],
        assignments: [{ assignment_id: 'asg_d2', marks: 19, submission_status: 'graded' }],
        exam_marks: [{ phase_id: 'phase_2', examMarks: 75 }],
        updatedBy: 1
      },
      db
    );
    await admitStudentToPhase(enrId, 3, db, { batchId: diplomaBatchId, onCommitAudit: () => {} });

    // 8.4 Phase 3 Fee remains UNPAID (৳5,000 due)
    const p3AcctUnpaid = resolvePhaseFee({
      feeDetailsRaw: enrRowP2Paid.fee_details,
      phaseIndex: 2,
      courseDefId: diplomaDefId,
      customDb: db
    });
    assert.strictEqual(p3AcctUnpaid.grossFee, 5000);
    assert.strictEqual(p3AcctUnpaid.cashCollected, 0);
    assert.strictEqual(p3AcctUnpaid.remainingDue, 5000);
    assert.strictEqual(p3AcctUnpaid.isPaid, false);

    // 8.5 Complete Phase 3 Academic Requirements
    console.log('--- 8.5 Complete Phase 3 academic requirements with fees unpaid ---');
    await updateDefinedProgressAtomic(
      enrId,
      {
        attendance: [{ class_id: 'cls_d3', attended: 1 }],
        assignments: [{ assignment_id: 'asg_d3', marks: 19, submission_status: 'graded' }],
        exam_marks: [{ phase_id: 'phase_3', examMarks: 78 }],
        updatedBy: 1
      },
      db
    );

    const progAllAcadDone = getEnrollmentProgressSync(enrId, db);
    assert.strictEqual(progAllAcadDone.phases[0].isPassed, true);
    assert.strictEqual(progAllAcadDone.phases[1].isPassed, true);
    assert.strictEqual(progAllAcadDone.phases[2].isPassed, true);
    // CRITICAL ENGINE ASSERTION: Even with 100% academic pass across all 3 phases, certificate is NOT eligible!
    assert.strictEqual(progAllAcadDone.certificateEligible, false, 'Certificate must NOT be eligible while Phase 3 fees are unpaid');
    console.log('✅ 8.5 Certificate gate verified: All 3 phases academically passed, but certificate withheld due to Phase 3 dues');

    // 8.6 Pay Phase 3 Fees via PUT /api/admin/students/:id and verify Certificate Eligibility
    console.log('--- 8.6 Pay Phase 3 fees in full via PUT /api/admin/students/:id ---');
    const phase3PaidPayload = JSON.parse(JSON.stringify(phase2PaidPayload));
    phase3PaidPayload['Directing Diploma 3-Phase'].phase3 = {
      full_fee: 5000,
      amount_paid: 5000,
      status: 'paid',
      installments: [{ id: 1, amount: 5000, date: '2026-11-01', method: 'bKash', status: 'paid' }]
    };

    const resP3Pay = await fetchWithTimeout(`${baseUrl}/api/admin/students/${studentUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${superAdminToken}` },
      body: JSON.stringify({
        firstName: 'Jamil',
        lastName: 'Hasan',
        email: 'jamil@bfi.edu',
        username: 'jamil',
        batchNumber: '01',
        courses: ['Directing Diploma 3-Phase'],
        course_fees: phase3PaidPayload
      })
    });
    assert.strictEqual(resP3Pay.status, 200);

    const enrRowP3Paid = db.prepare('SELECT fee_details FROM student_course_enrollments WHERE id = ?').get(enrId);
    const p3AcctPaid = resolvePhaseFee({
      feeDetailsRaw: enrRowP3Paid.fee_details,
      phaseIndex: 2,
      courseDefId: diplomaDefId,
      customDb: db
    });
    assert.strictEqual(p3AcctPaid.cashCollected, 5000);
    assert.strictEqual(p3AcctPaid.remainingDue, 0);
    assert.strictEqual(p3AcctPaid.isPaid, true);

    const progFinalEligible = getEnrollmentProgressSync(enrId, db);
    assert.strictEqual(progFinalEligible.certificateEligible, true, 'Certificate MUST be eligible once all phases are passed AND all phase fees are paid!');
    console.log('✅ 8.6 Dynamic progression engine confirms: certificateEligible = true after final payment through real route');

    // -------------------------------------------------------------
    // HTTP TEST 9: Certification Log-Download Trust-Boundary Safeguards & Negative Tests
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 9: Certification Log-Download Trust-Boundary Safeguards & Negative Tests ---');
    
    // Ensure Student Jamil (id 50) is enrolled in Batch 300001
    db.prepare('INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (300001, 50)').run();

    // Seed Student Karim (id 51, unpaid fees)
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version)
      VALUES (51, 'karim', 'karim@bfi.edu', 'hash', 'student', 'Karim', 'Uddin', 1, 0, 1)
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number)
      VALUES (51, 'Karim Uddin', 'BFI51', '01')
    `).run();
    db.prepare('INSERT OR IGNORE INTO batch_students (batch_id, student_id) VALUES (300001, 51)').run();
    const unpaidFeeJson = JSON.stringify({
      phase1: { full_fee: 5000, amount_paid: 0, status: 'unpaid' },
      phase2: { full_fee: 5000, amount_paid: 0, status: 'unpaid' },
      phase3: { full_fee: 5000, amount_paid: 0, status: 'unpaid' }
    });
    const enrKarimRes = db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, batch_id, course_definition_id, fee_details)
      VALUES (51, 'Directing Diploma 3-Phase', 'diploma', 300001, ?, ?)
    `).run(diplomaDefId, unpaidFeeJson);
    const enrIdKarim = enrKarimRes.lastInsertRowid;

    // Seed Student Salim (id 52, 2 enrollments of same course title)
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, email, password_hash, role, first_name, last_name, is_active, is_super_admin, token_version)
      VALUES (52, 'salim', 'salim@bfi.edu', 'hash', 'student', 'Salim', 'Khan', 1, 0, 1)
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO student_profiles (user_id, full_name, student_id, batch_number)
      VALUES (52, 'Salim Khan', 'BFI52', '01')
    `).run();
    db.prepare(`
      INSERT INTO batches (id, slug, batch_name, batch_number, course_name, course_definition_id, created_by)
      VALUES (300002, 'batch-02-salim', 'Diploma Batch 02', '02', 'Directing Diploma 3-Phase', ?, 1)
    `).run(diplomaDefId);
    db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, batch_id, course_definition_id, fee_details)
      VALUES (52, 'Directing Diploma 3-Phase', 'diploma', 300001, ?, '{}')
    `).run(diplomaDefId);
    db.prepare(`
      INSERT INTO student_course_enrollments (user_id, course_name, course_type, batch_id, course_definition_id, fee_details)
      VALUES (52, 'Directing Diploma 3-Phase', 'diploma', 300002, ?, '{}')
    `).run(diplomaDefId);

    const jamilToken = createValidToken({ id: 50, username: 'jamil', role: 'student', is_super_admin: 0 });
    const karimToken = createValidToken({ id: 51, username: 'karim', role: 'student', is_super_admin: 0 });
    const salimToken = createValidToken({ id: 52, username: 'salim', role: 'student', is_super_admin: 0 });

    const getDownloadsCount = () => db.prepare('SELECT COUNT(*) as count FROM certificate_downloads').get().count;
    const initialDownloadsCount = getDownloadsCount();

    // 9.1 Nonexistent enrollment
    console.log('--- 9.1 Nonexistent enrollment ID ---');
    const resNonexistent = await fetchWithTimeout(`${baseUrl}/api/certification/log-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jamilToken}` },
      body: JSON.stringify({ enrollmentId: 999999 })
    });
    assert.strictEqual(resNonexistent.status, 404);
    const bodyNonexistent = await resNonexistent.json();
    assert(bodyNonexistent.error.includes('Enrollment not found'));
    assert.strictEqual(getDownloadsCount(), initialDownloadsCount);
    console.log('✅ 9.1 Real route rejected nonexistent enrollment with HTTP 404, 0 DB changes');

    // 9.2 Another student's enrollment
    console.log('--- 9.2 Another student\'s enrollment ---');
    const resCrossStudent = await fetchWithTimeout(`${baseUrl}/api/certification/log-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${karimToken}` },
      body: JSON.stringify({ enrollmentId: enrId }) // Karim supplies Jamil's enrollment
    });
    assert.strictEqual(resCrossStudent.status, 403);
    const bodyCross = await resCrossStudent.json();
    assert(bodyCross.error.includes('Forbidden') || bodyCross.error.includes('own enrollment'));
    assert.strictEqual(getDownloadsCount(), initialDownloadsCount);
    console.log('✅ 9.2 Real route rejected cross-student enrollment with HTTP 403, 0 DB changes');

    // 9.3 Forged batch ID
    console.log('--- 9.3 Forged batch ID ---');
    const resForgedBatch = await fetchWithTimeout(`${baseUrl}/api/certification/log-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jamilToken}` },
      body: JSON.stringify({ enrollmentId: enrId, batchId: 999999 })
    });
    assert.strictEqual(resForgedBatch.status, 400);
    const bodyForgedBatch = await resForgedBatch.json();
    assert(bodyForgedBatch.error.includes('contradicts enrollment batch'));
    assert.strictEqual(getDownloadsCount(), initialDownloadsCount);
    console.log('✅ 9.3 Real route rejected forged batchId with HTTP 400, 0 DB changes');

    // 9.4 Forged courseDefinitionId
    console.log('--- 9.4 Forged courseDefinitionId ---');
    const resForgedDef = await fetchWithTimeout(`${baseUrl}/api/certification/log-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jamilToken}` },
      body: JSON.stringify({ enrollmentId: enrId, courseDefinitionId: 888888 })
    });
    assert.strictEqual(resForgedDef.status, 400);
    const bodyForgedDef = await resForgedDef.json();
    assert(bodyForgedDef.error.includes('contradicts enrollment course definition'));
    assert.strictEqual(getDownloadsCount(), initialDownloadsCount);
    console.log('✅ 9.4 Real route rejected forged courseDefinitionId with HTTP 400, 0 DB changes');

    // 9.5 Ambiguous same-title enrollments
    console.log('--- 9.5 Ambiguous same-title enrollments ---');
    const resAmbiguous = await fetchWithTimeout(`${baseUrl}/api/certification/log-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${salimToken}` },
      body: JSON.stringify({ courseName: 'Directing Diploma 3-Phase' }) // Salim has 2 enrollments for this title
    });
    assert.strictEqual(resAmbiguous.status, 409);
    const bodyAmbiguous = await resAmbiguous.json();
    assert(bodyAmbiguous.error.includes('Ambiguous request'));
    assert.strictEqual(getDownloadsCount(), initialDownloadsCount);
    console.log('✅ 9.5 Real route rejected ambiguous same-title enrollments with HTTP 409, 0 DB changes');

    // 9.6 Ineligible / unpaid student
    console.log('--- 9.6 Ineligible / unpaid student ---');
    const resUnpaid = await fetchWithTimeout(`${baseUrl}/api/certification/log-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${karimToken}` },
      body: JSON.stringify({ enrollmentId: enrIdKarim })
    });
    assert.strictEqual(resUnpaid.status, 403);
    const bodyUnpaid = await resUnpaid.json();
    assert(bodyUnpaid.error.includes('Certificate locked') || bodyUnpaid.error.includes('ineligible'));
    assert.strictEqual(getDownloadsCount(), initialDownloadsCount);

    // Verify batch progress certificates.issued is not corrupted
    const resProgressCheck = await fetchWithTimeout(`${baseUrl}/api/admin/batches/300001/progress`, {
      headers: { 'Authorization': `Bearer ${batchAdminToken}` }
    });
    assert.strictEqual(resProgressCheck.status, 200);
    const progressData = await resProgressCheck.json();
    assert.strictEqual(progressData.certificates.issued, 0, 'No certificates must be counted as issued prior to authorized download!');
    console.log('✅ 9.6 Real route rejected unpaid student with HTTP 403; batch progress certificates.issued remains strictly 0');

    // 9.7 Authorized eligible student download
    console.log('--- 9.7 Authorized eligible student download ---');
    const resAuthDownload = await fetchWithTimeout(`${baseUrl}/api/certification/log-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jamilToken}` },
      body: JSON.stringify({ enrollmentId: enrId })
    });
    assert.strictEqual(resAuthDownload.status, 200);
    assert.strictEqual(getDownloadsCount(), initialDownloadsCount + 1);

    const insertedRow = db.prepare('SELECT * FROM certificate_downloads WHERE enrollment_id = ?').get(enrId);
    assert.strictEqual(insertedRow.user_id, 50, 'Authoritative recipient user_id must be Jamil (50)');
    assert.strictEqual(insertedRow.downloaded_by, 50, 'downloaded_by must record Jamil (50)');
    assert.strictEqual(insertedRow.batch_id, 300001);
    assert.strictEqual(insertedRow.course_definition_id, diplomaDefId);

    // Check batch progress now reflects 1 issued certificate
    const resProgressAfter = await fetchWithTimeout(`${baseUrl}/api/admin/batches/300001/progress`, {
      headers: { 'Authorization': `Bearer ${batchAdminToken}` }
    });
    const progressAfter = await resProgressAfter.json();
    assert.strictEqual(progressAfter.certificates.issued, 1, 'Batch progress must now reflect 1 issued certificate for eligible downloaded student');
    console.log('✅ 9.7 Authorized download persisted correctly with derived enrollment identity and certificates.issued = 1');

    // 9.8 Admin logging download on behalf of student (recipient vs acting administrator separation)
    console.log('--- 9.8 Admin logging download on behalf of student ---');
    // Clear download row so admin can re-log
    db.prepare('DELETE FROM certificate_downloads WHERE enrollment_id = ?').run(enrId);
    const resAdminDownload = await fetchWithTimeout(`${baseUrl}/api/certification/log-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${batchAdminToken}` },
      body: JSON.stringify({ enrollmentId: enrId })
    });
    assert.strictEqual(resAdminDownload.status, 200);
    const adminInsertedRow = db.prepare('SELECT * FROM certificate_downloads WHERE enrollment_id = ?').get(enrId);
    assert.strictEqual(adminInsertedRow.user_id, 50, 'Authoritative recipient MUST be student Jamil (50)');
    assert.strictEqual(adminInsertedRow.downloaded_by, 2, 'downloaded_by MUST record acting administrator Batch Admin (2)');
    console.log('✅ 9.8 Admin download verified: recipient user_id (50) is cleanly separated from acting downloaded_by admin (2)');

    console.log('\n============================================================');
    console.log('🎉 ALL 9 REAL EXPRESS ROUTE & PAYMENT LIFECYCLE TESTS PASSED!');
    console.log('============================================================');
  } finally {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise(resolve => server.close(resolve));
    }
    if (db && typeof db.close === 'function') {
      try { db.close(); } catch { /* ignore */ }
    }
    cleanupDbFiles();
  }
}

run().then(() => {
  clearTimeout(watchdog);
  process.exit(0);
}).catch(err => {
  clearTimeout(watchdog);
  console.error('❌ Express route test error:', err);
  cleanupDbFiles();
  process.exit(1);
});
