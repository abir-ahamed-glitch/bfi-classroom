'use strict';
/**
 * scripts/test_real_express_routes.cjs
 *
 * Verifies the actual Express routes:
 * - server/routes/course-definitions.js
 * - server/routes/batches.js
 * over real HTTP requests using an isolated database via process.env.DATABASE_PATH.
 */

const path = require('path');
const fs = require('fs');

// Set isolated database path BEFORE any server module imports
const testDbPath = path.resolve(__dirname, '../server/test_real_express_routes.sqlite');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
process.env.DATABASE_PATH = testDbPath;
process.env.JWT_SECRET = 'test-jwt-secret-bfi-classroom-2026-very-secure';

const jwt = require('jsonwebtoken');
const express = require('express');
const http = require('http');
const assert = require('assert');

async function run() {
  const { default: db, initializeDatabase } = await import('../server/db/database.js');
  const { getJwtSecret } = await import('../server/config/security.js');

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

  db.prepare("INSERT INTO admin_permissions (user_id, permission) VALUES (2, 'batches:edit')").run();
  db.prepare("INSERT INTO admin_permissions (user_id, permission) VALUES (2, 'batches:view')").run();

  try {
    db.prepare("INSERT OR REPLACE INTO super_admin_users (user_id, granted_by) VALUES (1, 1)").run();
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
      type: 'access',
      sessionId: user.id === 2 ? 101 : 102
    };
    return jwt.sign(payload, getJwtSecret(), { expiresIn: '1h' });
  }

  const batchAdminToken = createValidToken({ id: 2, username: 'batchadmin', role: 'admin', is_super_admin: 0 });
  const superAdminToken = createValidToken({ id: 1, username: 'superadmin', role: 'admin', is_super_admin: 1 });

  // Import routers
  const { default: courseDefRouter } = await import('../server/routes/course-definitions.js');
  const { default: batchesRouter } = await import('../server/routes/batches.js');

  const app = express();
  app.use(express.json());
  app.use('/api/course-definitions', courseDefRouter);
  app.use('/api/admin/batches', batchesRouter);

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
    const resShortReason = await fetch(`${baseUrl}/api/course-definitions/${courseDefId}/routine`, {
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
    console.log('HTTP 1 RESPONSE:', resShortReason.status, jsonShort);
    assert.strictEqual(resShortReason.status, 400, 'HTTP route must return 400 for reason < 3 chars');
    assert.match(jsonShort.error, /at least 3 characters/i);
    console.log(`✅ 1.1 Real route rejected short reason with HTTP 400: "${jsonShort.error}"`);

    // -------------------------------------------------------------
    // HTTP TEST 2: Save Batch Routine Override via Real Route
    // -------------------------------------------------------------
    console.log('\n--- HTTP TEST 2: Save Batch Routine Override ---');
    const resSave = await fetch(`${baseUrl}/api/course-definitions/${courseDefId}/routine`, {
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
    const resGetBatch = await fetch(`${baseUrl}/api/admin/batches/100082`, {
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
    const resRevert = await fetch(`${baseUrl}/api/course-definitions/${courseDefId}/routine`, {
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
    console.log('HTTP 4 REVERT RESPONSE:', resRevert.status, jsonRevert);
    assert.strictEqual(resRevert.status, 200);
    assert.strictEqual(jsonRevert.reverted, true);
    assert.strictEqual(jsonRevert.effectiveSource, 'definition_baseline');
    assert.strictEqual(jsonRevert.effectiveRoutine.length, 1);
    assert.strictEqual(jsonRevert.effectiveRoutine[0].weekday, 'Saturday');
    console.log('✅ 4.1 Revert action cleared batch override and restored definition baseline via real route');

    // Verify read-back after revert via batches route
    const resGetAfterRevert = await fetch(`${baseUrl}/api/admin/batches/100082`, {
      headers: { 'Authorization': `Bearer ${batchAdminToken}` }
    });
    const jsonBatchAfterRevert = await resGetAfterRevert.json();
    const phaseAfterRevert = jsonBatchAfterRevert.course_definition?.definition?.phases[0];
    assert.strictEqual(phaseAfterRevert.routineSource, 'definition_baseline');
    assert.strictEqual(phaseAfterRevert.routine[0].weekday, 'Saturday');
    console.log('✅ 4.2 Batches route confirms baseline restoration after revert');

    console.log('\n============================================================');
    console.log('🎉 ALL REAL EXPRESS ROUTE HTTP TESTS PASSED WITH 100% SUCCESS.');
    console.log('============================================================');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ Express route test error:', err);
  process.exit(1);
});
