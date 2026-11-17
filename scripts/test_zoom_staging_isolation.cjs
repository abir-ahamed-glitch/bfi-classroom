const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadAndValidateStagingEnv } = require('./staging_guard.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bfi-zoom-staging-'));
const file = path.join(root, '.env.staging');
const required = [
  `DATABASE_PATH="${path.join(root, 'stage.db').replaceAll('\\', '/')}"`,
  `STAGING_DATA_DIR="${root.replaceAll('\\', '/')}"`,
  'PORT=3002',
  'HOST=127.0.0.1',
  `JWT_SECRET=${'s'.repeat(64)}`,
  `JWT_REFRESH_SECRET=${'r'.repeat(64)}`,
  `MFA_ENCRYPTION_KEY=${'a'.repeat(64)}`
].join('\n');

try {
  process.env.ZOOM_WEBHOOK_ENABLED = 'true';
  process.env.ZOOM_WEBHOOK_SECRET = 'inherited-fixture-secret';
  process.env.ZOOM_AUTO_ATTENDANCE_ENABLED = 'true';
  process.env.VITE_ZOOM_EMBED_ENABLED = 'true';
  fs.writeFileSync(file, required);
  loadAndValidateStagingEnv(file, {rejectConflicts: false});
  assert.equal(process.env.ZOOM_WEBHOOK_ENABLED, undefined);
  assert.equal(process.env.ZOOM_WEBHOOK_SECRET, undefined);
  assert.equal(process.env.ZOOM_AUTO_ATTENDANCE_ENABLED, undefined);
  assert.equal(process.env.VITE_ZOOM_EMBED_ENABLED, undefined);

  fs.writeFileSync(file, required + '\nZOOM_WEBHOOK_ENABLED=true\nZOOM_WEBHOOK_SECRET=staging-fixture-secret');
  loadAndValidateStagingEnv(file, {rejectConflicts: false});
  assert.equal(process.env.ZOOM_WEBHOOK_ENABLED, 'true');
  assert.equal(process.env.ZOOM_WEBHOOK_SECRET, 'staging-fixture-secret');
  assert.equal(process.env.ZOOM_AUTO_ATTENDANCE_ENABLED, undefined);
  assert.equal(process.env.DISABLE_OUTBOUND_NOTIFICATIONS, 'true');
  assert.equal(fs.existsSync(path.join(root, 'stage.db')), false);
  console.log('PASS: guarded staging clears inherited Zoom settings and loads explicit staging credentials only');
} finally {
  fs.rmSync(file, {force: true});
  fs.rmdirSync(root);
}
