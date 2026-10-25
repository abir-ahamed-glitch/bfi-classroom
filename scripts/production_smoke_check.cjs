#!/usr/bin/env node
/**
 * scripts/production_smoke_check.cjs
 *
 * Strict, fail-closed production smoke verification script.
 * Validates:
 *   Tier 1: Static SPA HTML shell availability (HTTP 200, text/html, root element)
 *   Tier 2: Unauthenticated Express routing & validation middleware (HTTP 400, valid JSON)
 *   Tier 3: Authenticated Admin Session & Profile API (HTTP 200, valid JSON, username match)
 *   Tier 4a: Super Admin Role-Gated Endpoint (HTTP 200, valid JSON, administrators array)
 *   Tier 4b: Ordinary Admin RBAC Access Rejection (HTTP 403, valid JSON, privilege required error)
 *
 * Exits with code 0 ONLY if all active assertions pass.
 * Exits with code 1 immediately on:
 *   - Unexpected HTTP status code
 *   - Malformed / non-parseable JSON
 *   - Missing required payload keys
 *   - Connection refused (ECONNREFUSED) / network failure
 *   - Request timeout (default 5000ms)
 *
 * Usage:
 *   node scripts/production_smoke_check.cjs [baseUrl] [--super-admin-token <token>] [--admin-token <token>] [--timeout <ms>]
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let baseUrl = process.env.APP_URL || 'http://127.0.0.1:3001';
  let superAdminToken = process.env.SUPER_ADMIN_TOKEN || null;
  let adminToken = process.env.ADMIN_TOKEN || null;
  let timeoutMs = parseInt(process.env.SMOKE_TIMEOUT_MS || '5000', 10);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--super-admin-token' && args[i + 1]) {
      superAdminToken = args[++i];
    } else if (arg === '--admin-token' && args[i + 1]) {
      adminToken = args[++i];
    } else if (arg === '--timeout' && args[i + 1]) {
      timeoutMs = parseInt(args[++i], 10);
    } else if (!arg.startsWith('--')) {
      baseUrl = arg;
    }
  }

  // Ensure trailing slash removed for clean concatenation
  baseUrl = baseUrl.replace(/\/+$/, '');
  return { baseUrl, superAdminToken, adminToken, timeoutMs };
}

// Low-level HTTP request helper enforcing strict timeout, JSON parsing, and connection handling
function makeRequest(urlStr, options = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
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
  console.log('================================================================');
  console.log('BFI CLASSROOM FAIL-CLOSED PRODUCTION SMOKE CHECK');
  console.log(`Target URL:  ${config.baseUrl}`);
  console.log(`Timeout:     ${config.timeoutMs}ms`);
  console.log(`Auth Tokens: SA=${config.superAdminToken ? 'PRESENT' : 'NONE'}, Ord=${config.adminToken ? 'PRESENT' : 'NONE'}`);
  console.log('================================================================\n');

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

  // ─────────────────────────────────────────────────────────────────────────────
  // Tier 3: Authenticated Admin Session & Profile API
  // ─────────────────────────────────────────────────────────────────────────────
  const authToken = config.adminToken || config.superAdminToken;
  if (authToken) {
    console.log('\n--- Tier 3: Authenticated Admin Profile API ---');
    const meUrl = `${config.baseUrl}/api/auth/me`;
    const meRes = await makeRequest(meUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` }
    }, config.timeoutMs);

    assertCondition(
      'Tier 3.1: Authenticated /api/auth/me returns HTTP 200',
      meRes.status === 200,
      `Expected status 200, received ${meRes.status}`
    );

    let meJson = null;
    try {
      meJson = JSON.parse(meRes.body);
    } catch (err) {
      assertCondition(
        'Tier 3.2: Authenticated /api/auth/me returns valid JSON',
        false,
        `Failed to parse response body: ${err.message}`
      );
    }
    assertCondition(
      'Tier 3.2: Authenticated /api/auth/me returns valid JSON',
      meJson !== null && typeof meJson === 'object'
    );

    assertCondition(
      'Tier 3.3: Authenticated /api/auth/me response contains valid username',
      typeof meJson.username === 'string' && meJson.username.length > 0,
      `Expected valid username in payload, received: ${JSON.stringify(meJson)}`
    );
  } else {
    console.log('\n⚠️ [SKIPPED] Tier 3: Authenticated Admin Profile (no auth token provided)');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tier 4a: Super Admin Role Guard Verification (HTTP 200)
  // ─────────────────────────────────────────────────────────────────────────────
  if (config.superAdminToken) {
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
  } else {
    console.log('\n⚠️ [SKIPPED] Tier 4a: Super Admin Endpoint (no --super-admin-token provided)');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tier 4b: Ordinary Admin RBAC Rejection (HTTP 403)
  // ─────────────────────────────────────────────────────────────────────────────
  if (config.adminToken) {
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
  } else {
    console.log('\n⚠️ [SKIPPED] Tier 4b: Ordinary Admin RBAC Rejection (no --admin-token provided)');
  }

  console.log('\n================================================================');
  console.log(`✅ PRODUCTION SMOKE CHECKS PASSED: ${checksPassed}/${totalChecks} assertions verified.`);
  console.log('================================================================');
  return true;
}

if (require.main === module) {
  runSmokeChecks()
    .then(() => process.exit(0))
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
