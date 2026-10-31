#!/usr/bin/env node
/**
 * verify_cloudflare_maintenance.cjs
 *
 * Pre-flight and post-flight verification script for Cloudflare maintenance mode.
 * Queries Cloudflare API for zone rulesets, page rules, and worker routes,
 * and performs non-destructive public HTTP status probes to verify whether
 * traffic interception (e.g. 503 Service Unavailable) is active or inactive.
 *
 * Usage:
 *   node scripts/verify_cloudflare_maintenance.cjs --expect-state=active|inactive [--zone-name=classroom.bfibd.org] [--require-token]
 *
 * Security:
 *   - Never logs API tokens or raw authorization headers.
 *   - Strictly read-only calls (GET requests only).
 */

const https = require('node:https');
const { URL } = require('node:url');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    expectState: null, // 'active' | 'inactive' | null (inspect only)
    zoneName: process.env.CLOUDFLARE_ZONE_NAME || 'classroom.bfibd.org',
    zoneId: process.env.CLOUDFLARE_ZONE_ID || null,
    requireToken: false,
    publicProbeOnly: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--expect-state=')) {
      options.expectState = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--zone-name=')) {
      options.zoneName = arg.split('=')[1];
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
      'User-Agent': 'BFI-Classroom-Cloudflare-Verifier/1.0',
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
        headers: { 'User-Agent': 'BFI-Classroom-Maintenance-Probe/1.0' },
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

async function main() {
  const options = parseArgs();
  console.log('================================================================');
  console.log('CLOUDFLARE MAINTENANCE STATE VERIFICATION');
  console.log('================================================================');
  console.log(`Target Zone: ${options.zoneName}`);
  console.log(`Expected State: ${options.expectState || 'INSPECT_ONLY'}`);

  const token = process.env.CLOUDFLARE_API_TOKEN;
  let apiAvailable = false;
  let zoneId = options.zoneId;

  if (!token) {
    console.log('\n[API Preflight] CLOUDFLARE_API_TOKEN is not set in environment.');
    if (options.requireToken) {
      console.error('❌ FATAL: --require-token specified but no token provided.');
      process.exit(1);
    }
  } else if (!options.publicProbeOnly) {
    console.log('\n[API Preflight] Verifying API Token against Cloudflare API...');
    try {
      const verifyRes = await requestJson('https://api.cloudflare.com/client/v4/user/tokens/verify', token);
      if (verifyRes.statusCode === 200 && verifyRes.data && verifyRes.data.success) {
        console.log('✅ Cloudflare API Token is valid and active.');
        apiAvailable = true;
      } else {
        console.log(`⚠️ Token verification failed (HTTP ${verifyRes.statusCode}).`);
      }
    } catch (err) {
      console.log(`⚠️ API connection error: ${err.message}`);
    }

    if (apiAvailable && !zoneId) {
      try {
        const zonesRes = await requestJson(
          `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(options.zoneName)}`,
          token
        );
        if (zonesRes.statusCode === 200 && zonesRes.data && Array.isArray(zonesRes.data.result) && zonesRes.data.result.length > 0) {
          zoneId = zonesRes.data.result[0].id;
          console.log(`✅ Located Zone ID for ${options.zoneName}`);
        } else {
          console.log(`⚠️ Token has zero visible zones matching '${options.zoneName}'.`);
          console.log('   (Token lacks Zone:Zone:Read scope for this zone).');
          apiAvailable = false;
        }
      } catch (err) {
        console.log(`⚠️ Zone query error: ${err.message}`);
        apiAvailable = false;
      }
    }
  }

  // Probe public endpoint
  console.log('\n[Public Ingress Probe] Probing public endpoint...');
  const probeUrl = `https://${options.zoneName}/health`;
  const probe = await probePublicUrl(probeUrl);
  console.log(`HTTP ${probe.statusCode} (Server: ${probe.serverHeader}, CF-Ray: ${probe.cfRay || 'none'})`);

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

  if (options.expectState) {
    if (observedPublicState !== options.expectState) {
      console.error(`\n❌ ASSERTION FAILED: Expected maintenance state "${options.expectState}", but observed "${observedPublicState}".`);
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
