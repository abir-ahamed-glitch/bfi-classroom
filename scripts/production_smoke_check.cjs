#!/usr/bin/env node
/**
 * scripts/production_smoke_check.cjs
 *
 * Strict, fail-closed production smoke verification script.
 * 
 * Deployment Verification Requirements:
 * - Requires BOTH Super Admin and Ordinary Admin credentials.
 * - Missing, empty, or whitespace credentials immediately exit non-zero (code 1).
 * - All required tiers (Tier 1, Tier 2, Tier 3, Tier 4a, Tier 4b) must execute and pass.
 * - Skipped checks are strictly forbidden for deployment approval.
 * - Partial diagnostics (--diagnostics) are explicitly separated from deployment verification
 *   and will never report deployment-ready approval.
 * - Credentials must NEVER be printed to stdout or stderr.
 * 
 * Usage:
 *   # Deployment Verification (Recommended via environment variables):
 *   SUPER_ADMIN_TOKEN="<token>" ADMIN_TOKEN="<token>" node scripts/production_smoke_check.cjs http://127.0.0.1:3001
 *
 *   # Partial Diagnostics (Non-approval):
 *   node scripts/production_smoke_check.cjs http://127.0.0.1:3001 --diagnostics
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');

// Parse configuration from environment and CLI
function parseArgs() {
  const args = process.argv.slice(2);
  let baseUrl = process.env.APP_URL || 'http://127.0.0.1:3001';
  let superAdminToken = process.env.SUPER_ADMIN_TOKEN || null;
  let adminToken = process.env.ADMIN_TOKEN || process.env.ORDINARY_ADMIN_TOKEN || null;
  let superAdminTokenFile = process.env.SUPER_ADMIN_TOKEN_FILE || null;
  let adminTokenFile = process.env.ADMIN_TOKEN_FILE || process.env.ORDINARY_ADMIN_TOKEN_FILE || null;
  let timeoutMs = parseInt(process.env.SMOKE_TIMEOUT_MS || '5000', 10);
  let diagnosticMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--super-admin-token' && args[i + 1]) {
      superAdminToken = args[++i];
    } else if ((arg === '--admin-token' || arg === '--ordinary-admin-token') && args[i + 1]) {
      adminToken = args[++i];
    } else if (arg === '--super-admin-token-file' && args[i + 1]) {
      superAdminTokenFile = args[++i];
    } else if ((arg === '--admin-token-file' || arg === '--ordinary-admin-token-file') && args[i + 1]) {
      adminTokenFile = args[++i];
    } else if (arg === '--timeout' && args[i + 1]) {
      timeoutMs = parseInt(args[++i], 10);
    } else if (arg === '--diagnostics' || arg === '--diagnostic') {
      diagnosticMode = true;
    } else if (!arg.startsWith('--')) {
      baseUrl = arg;
    }
  }

  // Load from token files if provided
  if (!superAdminToken && superAdminTokenFile) {
    try {
      superAdminToken = fs.readFileSync(superAdminTokenFile, 'utf8');
    } catch (err) {
      console.error(`❌ [CREDENTIAL ERROR] Failed to read Super Admin token file: ${err.message}`);
    }
  }
  if (!adminToken && adminTokenFile) {
    try {
      adminToken = fs.readFileSync(adminTokenFile, 'utf8');
    } catch (err) {
      console.error(`❌ [CREDENTIAL ERROR] Failed to read Ordinary Admin token file: ${err.message}`);
    }
  }

  // Sanitize: trim whitespace and convert empty/whitespace-only strings to null
  if (typeof superAdminToken === 'string') {
    superAdminToken = superAdminToken.trim();
    if (superAdminToken.length === 0) superAdminToken = null;
  }
  if (typeof adminToken === 'string') {
    adminToken = adminToken.trim();
    if (adminToken.length === 0) adminToken = null;
  }

  baseUrl = baseUrl.replace(/\/+$/, '');
  return { baseUrl, superAdminToken, adminToken, timeoutMs, diagnosticMode };
}

// Low-level HTTP request helper enforcing strict timeout, JSON parsing, and connection handling
function makeRequest(urlStr, options = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (err) {
      return reject(new Error(`Invalid URL '${urlStr}': ${err.message}`));
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: timeoutMs
    };

    let postData = null;
    if (options.body) {
      postData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      reqOptions.headers['Content-Type'] = reqOptions.headers['Content-Type'] || 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = transport.request(parsedUrl, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${urlStr} timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(new Error(`Connection failed to ${urlStr}: ${err.message || err.code}`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runSmokeChecks(config = parseArgs()) {
  const isDeployVerification = !config.diagnosticMode;

  console.log('================================================================');
  console.log(isDeployVerification
    ? 'BFI CLASSROOM FAIL-CLOSED PRODUCTION SMOKE CHECK (DEPLOYMENT VERIFICATION)'
    : 'BFI CLASSROOM PARTIAL SMOKE DIAGNOSTICS (NON-APPROVAL RUN)');
  console.log(`Target URL:  ${config.baseUrl}`);
  console.log(`Timeout:     ${config.timeoutMs}ms`);
  console.log(`Mode:        ${isDeployVerification ? 'STRICT DEPLOYMENT GATE (REQUIRES ALL TIERS)' : 'PARTIAL DIAGNOSTICS'}`);
  console.log(`Auth State:  SuperAdmin=${config.superAdminToken ? 'PRESENT' : 'MISSING/EMPTY'}, OrdinaryAdmin=${config.adminToken ? 'PRESENT' : 'MISSING/EMPTY'}`);
  console.log('================================================================\n');

  // Strict Deployment Gate Pre-flight: Both credentials are required.
  if (isDeployVerification) {
    const missing = [];
    if (!config.superAdminToken) {
      missing.push('Super Admin Token (SUPER_ADMIN_TOKEN or --super-admin-token)');
    }
    if (!config.adminToken) {
      missing.push('Ordinary Admin Token (ADMIN_TOKEN / ORDINARY_ADMIN_TOKEN or --admin-token)');
    }

    if (missing.length > 0) {
      console.error('❌ [FATAL PRE-CHECK ERROR] Deployment verification requires BOTH Super Admin and Ordinary Admin credentials.');
      console.error(`   Missing or empty credential(s): ${missing.join(', ')}`);
      console.error('   Skipped checks are strictly forbidden during deployment verification.');
      console.error('   All required tiers (Tier 1, Tier 2, Tier 3, Tier 4a, Tier 4b) must execute and pass.');
      console.error('   If partial unauthenticated diagnostics are intended, explicitly pass --diagnostics.\n');
      throw new Error(`Deployment verification rejected: missing required credentials (${missing.join(', ')})`);
    }
  }

  let checksPassed = 0;
  let totalChecks = 0;

  function assertCondition(desc, passed, detail = '') {
    totalChecks++;
    if (!passed) {
      console.error(`❌ [FAIL] ${desc}`);
      if (detail) console.error(`   Details: ${detail}`);
      throw new Error(`Smoke check assertion failed: ${desc}`);
    }
    console.log(`✅ [PASS] ${desc}`);
    checksPassed++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tier 1: Static SPA HTML Shell Availability
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- Tier 1: Static SPA HTML Shell ---');
  const spaUrl = `${config.baseUrl}/bfi-classroom/`;
  const spaRes = await makeRequest(spaUrl, { method: 'GET' }, config.timeoutMs);

  assertCondition(
    'Tier 1.1: SPA Shell returns HTTP 200',
    spaRes.status === 200,
    `Expected status 200, received ${spaRes.status}`
  );

  const contentType = (spaRes.headers['content-type'] || '').toLowerCase();
  assertCondition(
    'Tier 1.2: SPA Shell returns text/html content-type',
    contentType.includes('text/html'),
    `Expected content-type text/html, received ${contentType}`
  );

  assertCondition(
    'Tier 1.3: SPA Shell contains HTML root mount point',
    spaRes.body.includes('<div id="root">') || spaRes.body.includes('id="root"'),
    'Expected <div id="root"> in HTML response'
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Tier 2: Unauthenticated Backend API Routing & Input Validation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Tier 2: Unauthenticated Backend API Routing ---');
  const loginUrl = `${config.baseUrl}/api/auth/login`;
  const loginRes = await makeRequest(loginUrl, { method: 'POST', body: {} }, config.timeoutMs);

  assertCondition(
    'Tier 2.1: Login validation returns HTTP 400 Bad Request on empty payload',
    loginRes.status === 400,
    `Expected status 400, received ${loginRes.status}`
  );

  let loginJson = null;
  try {
    loginJson = JSON.parse(loginRes.body);
  } catch (err) {
    assertCondition(
      'Tier 2.2: Login validation returns valid JSON',
      false,
      `Failed to parse response body as JSON: ${err.message}`
    );
  }
  assertCondition(
    'Tier 2.2: Login validation returns valid JSON',
    loginJson !== null && typeof loginJson === 'object'
  );

  assertCondition(
    'Tier 2.3: Login validation contains expected error message',
    typeof loginJson.error === 'string' && loginJson.error.length > 0,
    `Expected json.error to be non-empty string, received: ${JSON.stringify(loginJson)}`
  );

  // If in diagnostic mode, conclude partial run and exit without claiming deployment readiness
  if (config.diagnosticMode) {
    console.log('\n================================================================');
    console.log(`⚠️ [PARTIAL DIAGNOSTIC COMPLETE] ${checksPassed}/${totalChecks} unauthenticated assertions verified.`);
    console.log('   Notice: This run was executed with --diagnostics.');
    console.log('   This output is for troubleshooting only and DOES NOT authorize deployment.');
    console.log('   Deployment approval strictly requires all tiers (1, 2, 3, 4a, 4b).');
    console.log('================================================================');
    return { deploymentApproved: false, diagnosticPassed: true, checksPassed, totalChecks };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tier 3: Authenticated Admin Session & Profile API (Ordinary & Super Admin)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Tier 3: Authenticated Admin Profile API ---');
  const meUrl = `${config.baseUrl}/api/auth/me`;

  // 3a. Ordinary Admin profile verification
  const ordMeRes = await makeRequest(meUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.adminToken}` }
  }, config.timeoutMs);

  assertCondition(
    'Tier 3.1: Authenticated Ordinary Admin /api/auth/me returns HTTP 200',
    ordMeRes.status === 200,
    `Expected status 200, received ${ordMeRes.status}`
  );

  let ordMeJson = null;
  try {
    ordMeJson = JSON.parse(ordMeRes.body);
  } catch (err) {
    assertCondition(
      'Tier 3.2: Authenticated Ordinary Admin /api/auth/me returns valid JSON',
      false,
      `Failed to parse response body: ${err.message}`
    );
  }
  assertCondition(
    'Tier 3.2: Authenticated Ordinary Admin /api/auth/me returns valid JSON',
    ordMeJson !== null && typeof ordMeJson === 'object'
  );

  assertCondition(
    'Tier 3.3: Authenticated Ordinary Admin payload contains valid username',
    typeof ordMeJson.username === 'string' && ordMeJson.username.length > 0,
    `Expected valid username in payload, received: ${JSON.stringify(ordMeJson)}`
  );

  // 3b. Super Admin profile verification
  const saMeRes = await makeRequest(meUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.superAdminToken}` }
  }, config.timeoutMs);

  assertCondition(
    'Tier 3.4: Authenticated Super Admin /api/auth/me returns HTTP 200',
    saMeRes.status === 200,
    `Expected status 200, received ${saMeRes.status}`
  );

  let saMeJson = null;
  try {
    saMeJson = JSON.parse(saMeRes.body);
  } catch (err) {
    assertCondition(
      'Tier 3.5: Authenticated Super Admin /api/auth/me returns valid JSON',
      false,
      `Failed to parse response body: ${err.message}`
    );
  }
  assertCondition(
    'Tier 3.5: Authenticated Super Admin /api/auth/me returns valid JSON',
    saMeJson !== null && typeof saMeJson === 'object'
  );

  assertCondition(
    'Tier 3.6: Authenticated Super Admin payload identifies Super Admin privilege',
    saMeJson.is_super_admin === 1 || saMeJson.isSuperAdmin === true,
    `Expected is_super_admin: 1 or isSuperAdmin: true, received: ${JSON.stringify(saMeJson)}`
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Tier 4a: Super Admin Role Guard Verification (HTTP 200)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Tier 4a: Super Admin Endpoint Access ---');
  const saUrl = `${config.baseUrl}/api/admin/administrators`;
  const saRes = await makeRequest(saUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.superAdminToken}` }
  }, config.timeoutMs);

  assertCondition(
    'Tier 4a.1: Super Admin GET /api/admin/administrators returns HTTP 200',
    saRes.status === 200,
    `Expected status 200, received ${saRes.status}`
  );

  let saJson = null;
  try {
    saJson = JSON.parse(saRes.body);
  } catch (err) {
    assertCondition(
      'Tier 4a.2: Super Admin response is valid JSON',
      false,
      `Failed to parse response: ${err.message}`
    );
  }
  assertCondition(
    'Tier 4a.2: Super Admin response is valid JSON',
    saJson !== null && typeof saJson === 'object'
  );

  assertCondition(
    'Tier 4a.3: Super Admin response contains administrators array',
    Array.isArray(saJson.administrators),
    `Expected administrators array, received: ${JSON.stringify(saJson)}`
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Tier 4b: Ordinary Admin RBAC Rejection (HTTP 403)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Tier 4b: Ordinary Admin RBAC Access Rejection ---');
  const ordUrl = `${config.baseUrl}/api/admin/administrators`;
  const ordRes = await makeRequest(ordUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.adminToken}` }
  }, config.timeoutMs);

  assertCondition(
    'Tier 4b.1: Ordinary Admin GET /api/admin/administrators returns HTTP 403 Forbidden',
    ordRes.status === 403,
    `Expected status 403, received ${ordRes.status}`
  );

  let ordJson = null;
  try {
    ordJson = JSON.parse(ordRes.body);
  } catch (err) {
    assertCondition(
      'Tier 4b.2: 403 response returns valid JSON',
      false,
      `Failed to parse response: ${err.message}`
    );
  }
  assertCondition(
    'Tier 4b.2: 403 response returns valid JSON',
    ordJson !== null && typeof ordJson === 'object'
  );

  assertCondition(
    'Tier 4b.3: 403 response contains Super Administrator privilege error',
    typeof ordJson.error === 'string' && ordJson.error.includes('Super Administrator privilege required'),
    `Expected error message containing 'Super Administrator privilege required', received: ${JSON.stringify(ordJson)}`
  );

  console.log('\n================================================================');
  console.log(`✅ PRODUCTION SMOKE VERIFICATION PASSED: ${checksPassed}/${totalChecks} assertions verified.`);
  console.log('   All required tiers (Tier 1, Tier 2, Tier 3, Tier 4a, Tier 4b) passed.');
  console.log('   Deployment gate cleared.');
  console.log('================================================================');
  return { deploymentApproved: true, checksPassed, totalChecks };
}

if (require.main === module) {
  runSmokeChecks()
    .then((result) => {
      if (result && result.deploymentApproved === false) {
        // Diagnostic run finished cleanly, but not authorized for deployment
        process.exit(0);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\n❌ [SMOKE CHECK HALT]: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  runSmokeChecks,
  makeRequest,
  parseArgs
};
