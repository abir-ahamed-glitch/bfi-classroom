#!/usr/bin/env node
/**
 * verify_cloudflare_maintenance.cjs
 *
 * Pre-flight and post-flight verification script for Cloudflare maintenance mode.
 * Queries Cloudflare API for zone rulesets, worker routes, and custom error pages
 * within the parent DNS zone (e.g. bfibd.org), and performs public HTTP status
 * probes against the target hostname (e.g. classroom.bfibd.org).
 *
 * Usage:
 *   node scripts/verify_cloudflare_maintenance.cjs --expect-state=active|inactive [--zone-name=bfibd.org] [--host=classroom.bfibd.org]
 *
 * Exit Codes:
 *   0 = CONFIRMED  (maintenance state verified matching expectation)
 *   1 = VIOLATED   (maintenance state contradicts expectation or invalid arguments)
 *   2 = UNVERIFIED (could not verify: missing token, zone not found, or API scope error)
 *
 * Security:
 *   - Strictly read-only calls (GET requests only).
 *   - Never logs tokens or raw authorization headers.
 */

const https = require('node:https');
const { URL } = require('node:url');

const INTERCEPTING_ERROR_PAGE_IDS = [
  '500_errors',
  '1000_errors',
  'always_online',
  'basic_challenge',
  'waf_challenge',
  'ip_block',
  'waf_block',
  'country_challenge',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    expectState: null, // 'active' | 'inactive' | null (inspect only)
    zoneName: process.env.CLOUDFLARE_ZONE_NAME || 'bfibd.org',
    host: process.env.CLOUDFLARE_HOST || 'classroom.bfibd.org',
    zoneId: process.env.CLOUDFLARE_ZONE_ID || null,
  };

  for (const arg of args) {
    if (arg.startsWith('--expect-state=')) {
      const rawVal = arg.split('=')[1];
      const val = (rawVal || '').toLowerCase().trim();
      if (val !== 'active' && val !== 'inactive') {
        console.error(`Error: Invalid --expect-state="${rawVal}". Allowed values are "active" or "inactive".`);
        process.exit(1);
      }
      options.expectState = val;
    } else if (arg.startsWith('--zone-name=')) {
      options.zoneName = arg.split('=')[1];
    } else if (arg.startsWith('--host=')) {
      options.host = arg.split('=')[1];
    } else if (arg.startsWith('--zone-id=')) {
      options.zoneId = arg.split('=')[1];
    }
  }

  return options;
}

function requestJson(urlStr, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const headers = {
      'User-Agent': 'BFI-Classroom-Cloudflare-Verifier/2.0',
      'Accept': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    const req = https.request(
      url,
      {
        method: 'GET',
        headers,
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch {
            resolve({ statusCode: res.statusCode, raw: data });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out to ${url.hostname}`));
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

function probePublicUrl(urlStr) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'BFI-Classroom-Maintenance-Probe/2.0' },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            serverHeader: res.headers.server || 'unknown',
            cfRay: res.headers['cf-ray'] || null,
            contentType: res.headers['content-type'] || '',
            bodySnippet: body.slice(0, 200).replace(/\s+/g, ' ').trim(),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 0, error: 'ETIMEDOUT' });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 0, error: err.message });
    });

    req.end();
  });
}

function routeMatchesHost(pattern, targetHost) {
  if (!pattern || typeof pattern !== 'string') return false;
  let clean = pattern.trim().toLowerCase();
  clean = clean.replace(/^[a-z]+:\/\//, '');
  const slashIdx = clean.indexOf('/');
  const hostPartWithPort = slashIdx >= 0 ? clean.slice(0, slashIdx) : clean;
  const colonIdx = hostPartWithPort.indexOf(':');
  const routeHost = colonIdx >= 0 ? hostPartWithPort.slice(0, colonIdx) : hostPartWithPort;
  const host = targetHost.toLowerCase();

  if (routeHost === host) return true;
  if (routeHost === `*.${host}`) return true;
  if (routeHost.startsWith('*.')) {
    const suffix = routeHost.slice(2);
    if (host.endsWith(`.${suffix}`) || host === suffix) return true;
  }
  if (routeHost === '*') return true;
  return false;
}

async function inspectZoneMaintenance(zoneId, token, targetHost) {
  const findings = {
    activeRulesets: [],
    activeWorkerRoutes: [],
    customErrorPages: [],
    evaluatedPageIds: [],
    skippedChecks: [],
    errors: [],
  };

  // 1. Inspect Rulesets
  try {
    const res = await requestJson(`https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets`, token);
    if (res.statusCode === 200 && res.data && Array.isArray(res.data.result)) {
      const maintenanceRulesets = res.data.result.filter((r) => r.phase === 'http_request_maintenance');
      for (const rs of maintenanceRulesets) {
        findings.activeRulesets.push(rs.name || rs.id);
      }
    } else if (res.statusCode === 403) {
      findings.skippedChecks.push('Rulesets:Read (HTTP 403 Forbidden)');
    } else {
      findings.errors.push(`Zone Rulesets query returned HTTP ${res.statusCode}`);
    }
  } catch (err) {
    findings.errors.push(`Zone Rulesets error: ${err.message}`);
  }

  // 2. Inspect Worker Routes
  try {
    const res = await requestJson(`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`, token);
    if (res.statusCode === 200 && res.data && Array.isArray(res.data.result)) {
      const activeRoutes = res.data.result.filter((route) => routeMatchesHost(route.pattern, targetHost));
      for (const route of activeRoutes) {
        findings.activeWorkerRoutes.push(`${route.pattern} -> ${route.script || 'unknown'}`);
      }
    } else if (res.statusCode === 403) {
      findings.skippedChecks.push('Workers:Routes:Read (HTTP 403 Forbidden)');
    } else {
      findings.errors.push(`Worker Routes query returned HTTP ${res.statusCode}`);
    }
  } catch (err) {
    findings.errors.push(`Worker Routes error: ${err.message}`);
  }

  // 3. Inspect Custom Error Pages (interception capable only)
  try {
    const res = await requestJson(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_pages`, token);
    if (res.statusCode === 200 && res.data && Array.isArray(res.data.result)) {
      const interceptingPages = res.data.result.filter((p) => INTERCEPTING_ERROR_PAGE_IDS.includes(p.id));
      findings.evaluatedPageIds = interceptingPages.map((p) => p.id);
      for (const p of interceptingPages) {
        if (p.url && p.state === 'customized') {
          findings.customErrorPages.push(`${p.id} (${p.url})`);
        }
      }
    } else if (res.statusCode === 403) {
      findings.skippedChecks.push('Custom Pages:Read (HTTP 403 Forbidden)');
    } else {
      findings.errors.push(`Custom Error Pages query returned HTTP ${res.statusCode}`);
    }
  } catch (err) {
    findings.errors.push(`Custom Error Pages error: ${err.message}`);
  }

  return findings;
}

async function listVisibleZones(token) {
  try {
    const res = await requestJson('https://api.cloudflare.com/client/v4/zones?per_page=50', token);
    if (res.statusCode === 200 && res.data && Array.isArray(res.data.result)) {
      return res.data.result.map((z) => z.name);
    }
    return [];
  } catch {
    return [];
  }
}

async function main() {
  const options = parseArgs();

  console.log('================================================================');
  console.log('CLOUDFLARE MAINTENANCE STATE VERIFICATION (v2.1)');
  console.log('================================================================');
  console.log(`Target DNS Zone: ${options.zoneName}`);
  console.log(`Target Hostname: ${options.host}`);
  console.log(`Expected State:  ${options.expectState || 'INSPECT_ONLY'}`);

  const token = process.env.CLOUDFLARE_API_TOKEN;
  let zoneId = options.zoneId;
  let zoneFound = false;
  let zoneFindings = null;

  if (!token) {
    console.log('\n[API Preflight] CLOUDFLARE_API_TOKEN is not set in environment.');
    console.error('\nVERDICT: UNVERIFIED');
    console.error('Reason: No Cloudflare API token supplied — zone maintenance state cannot be confirmed.');
    process.exit(2);
  }

  console.log(`\n[API Preflight] Querying zone record for: "${options.zoneName}"`);
  try {
    const zonesRes = await requestJson(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(options.zoneName)}`,
      token
    );
    if (zonesRes.statusCode === 200 && zonesRes.data && Array.isArray(zonesRes.data.result)) {
      if (zonesRes.data.result.length > 0) {
        zoneId = zonesRes.data.result[0].id;
        zoneFound = true;
        console.log(`✅ Located Zone "${options.zoneName}" (Zone ID: ${zoneId})`);
      } else {
        console.error(`❌ Zone lookup returned 0 matching zones for name "${options.zoneName}".`);
        console.error(`   Searched zone name: "${options.zoneName}"`);
        const visibleZones = await listVisibleZones(token);
        if (visibleZones.length > 0) {
          console.error(`   Visible zones for this token (${visibleZones.length}): ${visibleZones.join(', ')}`);
        } else {
          console.error('   Visible zones for this token: none');
        }
        console.error(`\nVERDICT: UNVERIFIED`);
        console.error(`Reason: Zone "${options.zoneName}" was not found — maintenance state NOT confirmed.`);
        process.exit(2);
      }
    } else if (zonesRes.statusCode === 403) {
      console.error(`⚠️  Token lacks permission to query zones (HTTP 403 Forbidden).`);
      console.error(`\nVERDICT: UNVERIFIED`);
      console.error(`Reason: Token lacks Zone:Read permission (HTTP 403) — maintenance state NOT confirmed.`);
      process.exit(2);
    } else {
      console.error(`⚠️  Zone query for "${options.zoneName}" returned HTTP ${zonesRes.statusCode}`);
      console.error(`\nVERDICT: UNVERIFIED`);
      console.error(`Reason: Zone lookup failed (HTTP ${zonesRes.statusCode}) — maintenance state NOT confirmed.`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`⚠️  Zone lookup transport error: ${err.message}`);
    console.error(`\nVERDICT: UNVERIFIED`);
    console.error(`Reason: Zone lookup error (${err.message}) — maintenance state NOT confirmed.`);
    process.exit(2);
  }

  console.log('\n[Zone Governance] Inspecting zone maintenance mechanisms...');
  zoneFindings = await inspectZoneMaintenance(zoneId, token, options.host);
  console.log(`- Maintenance Rulesets: ${zoneFindings.activeRulesets.length}`);
  console.log(`- Active Worker Routes on Host: ${zoneFindings.activeWorkerRoutes.length}`);
  console.log(`- Custom Error Pages Active: ${zoneFindings.customErrorPages.length}`);
  if (zoneFindings.evaluatedPageIds.length > 0) {
    console.log(`  (Evaluated intercepting page types: ${zoneFindings.evaluatedPageIds.join(', ')})`);
  }
  for (const s of zoneFindings.skippedChecks) {
    console.log(`  ℹ️  Zone check skipped: Token lacks ${s}`);
  }
  for (const e of zoneFindings.errors) {
    console.log(`  ⚠️  Zone check error: ${e}`);
  }

  // Probe public endpoint
  console.log('\n[Public Ingress Probe] Probing public endpoint...');
  const probeUrl = `https://${options.host}/health`;
  const probe = await probePublicUrl(probeUrl);
  console.log(`Endpoint: ${probeUrl}`);
  console.log(`Response: HTTP ${probe.statusCode} (Server: ${probe.serverHeader}, CF-Ray: ${probe.cfRay || 'none'})`);

  let observedPublicState = 'unknown';
  if (probe.statusCode === 503) {
    observedPublicState = 'active';
    console.log('Observed Public Status: MAINTENANCE_ACTIVE (HTTP 503)');
  } else if (probe.statusCode === 200) {
    observedPublicState = 'inactive';
    console.log('Observed Public Status: MAINTENANCE_INACTIVE (HTTP 200 Live App)');
  } else {
    console.log(`Observed Public Status: UNEXPECTED (HTTP ${probe.statusCode})`);
  }

  // Check if any checks were skipped or errors occurred
  if (zoneFindings.skippedChecks.length > 0) {
    console.error(`\nVERDICT: UNVERIFIED`);
    console.error(`UNVERIFIED: ${zoneFindings.skippedChecks.length} zone checks skipped (token lacks scope) — maintenance state NOT confirmed.`);
    for (const s of zoneFindings.skippedChecks) {
      console.error(`  - ${s}`);
    }
    process.exit(2);
  }

  if (zoneFindings.errors.length > 0) {
    console.error(`\nVERDICT: UNVERIFIED`);
    console.error(`UNVERIFIED: ${zoneFindings.errors.length} zone checks encountered errors — maintenance state NOT confirmed.`);
    process.exit(2);
  }

  const zoneMaintenanceActive = (
    zoneFindings.activeRulesets.length > 0 ||
    zoneFindings.activeWorkerRoutes.length > 0 ||
    zoneFindings.customErrorPages.length > 0
  );

  if (options.expectState === 'inactive') {
    if (observedPublicState === 'inactive' && !zoneMaintenanceActive) {
      console.log('\nVERDICT: CONFIRMED');
      console.log('PASS: Maintenance state confirmed as "inactive" (0 active zone mechanisms, public probe HTTP 200).');
      process.exit(0);
    } else {
      console.error('\nVERDICT: VIOLATED');
      if (zoneMaintenanceActive) {
        console.error('FAIL: Expected maintenance to be inactive, but active zone maintenance mechanisms were detected.');
        if (zoneFindings.activeRulesets.length > 0) {
          console.error(`  Rulesets: ${zoneFindings.activeRulesets.join(', ')}`);
        }
        if (zoneFindings.activeWorkerRoutes.length > 0) {
          console.error(`  Worker Routes: ${zoneFindings.activeWorkerRoutes.join(', ')}`);
        }
        if (zoneFindings.customErrorPages.length > 0) {
          console.error(`  Custom Error Pages: ${zoneFindings.customErrorPages.join(', ')}`);
        }
      }
      if (observedPublicState !== 'inactive') {
        console.error(`FAIL: Expected public probe HTTP 200 (inactive), but observed HTTP ${probe.statusCode} (${observedPublicState}).`);
      }
      process.exit(1);
    }
  } else if (options.expectState === 'active') {
    if (observedPublicState === 'active' && zoneMaintenanceActive) {
      console.log('\nVERDICT: CONFIRMED');
      console.log('PASS: Maintenance state confirmed as "active" (active zone mechanism confirmed, public probe HTTP 503).');
      process.exit(0);
    } else {
      console.error('\nVERDICT: VIOLATED');
      if (observedPublicState !== 'active') {
        console.error(`FAIL: Expected public probe HTTP 503 (active), but observed HTTP ${probe.statusCode} (${observedPublicState}).`);
      }
      if (!zoneMaintenanceActive) {
        console.error('FAIL: Public probe did not find active maintenance mechanisms in zone configuration.');
      }
      process.exit(1);
    }
  }

  console.log('\nVERDICT: CONFIRMED');
  console.log('Verification complete (inspection mode, no expectation asserted).');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\nFATAL: Unhandled error in verifier: ${err.message}`);
  process.exit(2);
});
