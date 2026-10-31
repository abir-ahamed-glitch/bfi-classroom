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
 *   node scripts/verify_cloudflare_maintenance.cjs --expect-state=active|inactive [--zone-name=bfibd.org] [--host=classroom.bfibd.org] [--require-token]
 *
 * Security:
 *   - Strictly read-only calls (GET requests only).
 *   - Never logs tokens or raw authorization headers.
 */

const https = require('node:https');
const { URL } = require('node:url');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    expectState: null, // 'active' | 'inactive' | null (inspect only)
    zoneName: process.env.CLOUDFLARE_ZONE_NAME || 'bfibd.org',
    host: process.env.CLOUDFLARE_HOST || 'classroom.bfibd.org',
    zoneId: process.env.CLOUDFLARE_ZONE_ID || null,
    requireToken: false,
    publicProbeOnly: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--expect-state=')) {
      options.expectState = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--zone-name=')) {
      options.zoneName = arg.split('=')[1];
    } else if (arg.startsWith('--host=')) {
      options.host = arg.split('=')[1];
    } else if (arg.startsWith('--zone-id=')) {
      options.zoneId = arg.split('=')[1];
    } else if (arg === '--require-token') {
      options.requireToken = true;
    } else if (arg === '--public-probe-only') {
      options.publicProbeOnly = true;
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

async function inspectZoneMaintenance(zoneId, token, targetHost) {
  const findings = {
    activeRulesets: [],
    activeWorkerRoutes: [],
    customErrorPages: [],
    warnings: [],
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
      findings.warnings.push('Zone Rulesets read skipped: Token lacks Rulesets:Read permission (HTTP 403)');
    } else {
      findings.warnings.push(`Zone Rulesets query returned HTTP ${res.statusCode}`);
    }
  } catch (err) {
    findings.warnings.push(`Zone Rulesets error: ${err.message}`);
  }

  // 2. Inspect Worker Routes
  try {
    const res = await requestJson(`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`, token);
    if (res.statusCode === 200 && res.data && Array.isArray(res.data.result)) {
      for (const route of res.data.result) {
        if (route.pattern && (route.pattern.includes(targetHost) || route.pattern.includes('*'))) {
          findings.activeWorkerRoutes.push(`${route.pattern} -> ${route.script || 'unknown'}`);
        }
      }
    } else if (res.statusCode === 403) {
      findings.warnings.push('Worker Routes read skipped: Token lacks Workers:Routes:Read permission (HTTP 403)');
    } else {
      findings.warnings.push(`Worker Routes query returned HTTP ${res.statusCode}`);
    }
  } catch (err) {
    findings.warnings.push(`Worker Routes error: ${err.message}`);
  }

  // 3. Inspect Custom Error Pages
  try {
    const res = await requestJson(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_pages`, token);
    if (res.statusCode === 200 && res.data && Array.isArray(res.data.result)) {
      for (const page of res.data.result) {
        if (page.url && page.state === 'customized') {
          findings.customErrorPages.push(`${page.description || page.id} (URL: ${page.url})`);
        }
      }
    } else if (res.statusCode === 403) {
      findings.warnings.push('Custom Pages read skipped: Token lacks Custom Pages permission (HTTP 403)');
    } else {
      findings.warnings.push(`Custom Pages query returned HTTP ${res.statusCode}`);
    }
  } catch (err) {
    findings.warnings.push(`Custom Pages error: ${err.message}`);
  }

  return findings;
}

async function main() {
  const options = parseArgs();
  console.log('================================================================');
  console.log('CLOUDFLARE MAINTENANCE STATE VERIFICATION (v2.0)');
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
    if (options.requireToken) {
      console.error('❌ FATAL: --require-token specified but no token provided.');
      process.exit(1);
    }
  } else if (!options.publicProbeOnly) {
    console.log('\n[API Preflight] Querying zone record for:', options.zoneName);
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
          console.log(`⚠️ Zone lookup returned 0 matching zones for name "${options.zoneName}".`);
          console.log('   (Ensure --zone-name specifies the parent DNS zone e.g. "bfibd.org", not a subdomain).');
        }
      } else if (zonesRes.statusCode === 403) {
        console.log('⚠️ Token lacks permission to list zones (HTTP 403 Forbidden).');
      } else {
        console.log(`⚠️ Zone lookup returned HTTP ${zonesRes.statusCode}`);
      }
    } catch (err) {
      console.log(`⚠️ Zone lookup error: ${err.message}`);
    }

    if (zoneFound && zoneId) {
      console.log('\n[Zone Governance] Inspecting zone maintenance mechanisms...');
      zoneFindings = await inspectZoneMaintenance(zoneId, token, options.host);
      console.log(`- Maintenance Rulesets: ${zoneFindings.activeRulesets.length}`);
      console.log(`- Active Worker Routes on Host: ${zoneFindings.activeWorkerRoutes.length}`);
      console.log(`- Custom Error Pages Active: ${zoneFindings.customErrorPages.length}`);
      for (const w of zoneFindings.warnings) {
        console.log(`  ℹ️  ${w}`);
      }
    }
  }

  // Probe public endpoint
  console.log('\n[Public Ingress Probe] Probing public endpoint...');
  const probeUrl = `https://${options.host}/health`;
  const probe = await probePublicUrl(probeUrl);
  console.log(`Endpoint: ${probeUrl}`);
  console.log(`Response: HTTP ${probe.statusCode} (Server: ${probe.serverHeader}, CF-Ray: ${probe.cfRay || 'none'})`);

  let observedPublicState = 'unknown';
  if (probe.statusCode === 503) {
    observedPublicState = 'active'; // Maintenance page active
    console.log('Observed Public Status: MAINTENANCE_ACTIVE (HTTP 503)');
  } else if (probe.statusCode === 200) {
    observedPublicState = 'inactive'; // Live application traffic passing
    console.log('Observed Public Status: MAINTENANCE_INACTIVE (HTTP 200 Live App)');
  } else {
    console.log(`Observed Public Status: UNEXPECTED (HTTP ${probe.statusCode})`);
  }

  // Zone mechanism check
  let zoneMaintenanceDetected = false;
  if (zoneFindings) {
    if (zoneFindings.activeRulesets.length > 0 || zoneFindings.activeWorkerRoutes.length > 0 || zoneFindings.customErrorPages.length > 0) {
      zoneMaintenanceDetected = true;
    }
  }

  if (options.expectState) {
    let failureReason = null;
    if (options.expectState === 'inactive') {
      if (observedPublicState !== 'inactive') {
        failureReason = `Expected public state "inactive", but observed HTTP ${probe.statusCode} (${observedPublicState}).`;
      } else if (zoneMaintenanceDetected) {
        failureReason = `Expected maintenance to be inactive, but active zone maintenance mechanisms were detected.`;
      }
    } else if (options.expectState === 'active') {
      if (observedPublicState !== 'active') {
        failureReason = `Expected public state "active" (HTTP 503), but observed HTTP ${probe.statusCode} (${observedPublicState}).`;
      }
    }

    if (failureReason) {
      console.error(`\n❌ ASSERTION FAILED: ${failureReason}`);
      process.exit(1);
    } else {
      console.log(`\n✅ PASS: Maintenance state confirmed as "${options.expectState}".`);
    }
  } else {
    console.log('\n✅ Verification complete (inspection only).');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`Unhandled error: ${err.message}`);
  process.exit(1);
});
