const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const path = require('path');

let totalTests = 0;
let passedTests = 0;

function assert(name, condition, detail = '') {
  totalTests++;
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`❌ [FAIL] ${name}`);
    if (detail) console.error(`   Details: ${detail}`);
    process.exit(1);
  }
}

const tenancy = process.env.OCI_TENANCY_OCID;
const user = process.env.OCI_USER_OCID;
const fingerprint = process.env.OCI_FINGERPRINT;
const region = process.env.OCI_REGION || 'ap-singapore-1';

const missing = [];
if (!tenancy) missing.push('OCI_TENANCY_OCID');
if (!user) missing.push('OCI_USER_OCID');
if (!fingerprint) missing.push('OCI_FINGERPRINT');

if (missing.length > 0) {
  console.log(`⚠️  Required OCI credentials not configured (missing: ${missing.join(', ')}).`);
  console.log('Skipping live OCI API call — 0 assertions executed.');
  process.exit(0);
}

const baseDir = process.env.USERPROFILE || process.env.HOME || '';
const privateKeyPath = process.env.OCI_KEY_PATH || path.join(baseDir, '.oci', 'oci_api_key.pem');

if (!fs.existsSync(privateKeyPath)) {
  console.log(`⚠️  Private key file not found at: ${privateKeyPath}`);
  console.log('Skipping live OCI API call — 0 assertions executed.');
  process.exit(0);
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const host = `iaas.${region}.oraclecloud.com`;
const targetPath = `/20160918/availabilityDomains?compartmentId=${encodeURIComponent(tenancy)}`;
const date = new Date().toUTCString();

const signingString = `date: ${date}\n(request-target): get ${targetPath}\nhost: ${host}`;
const sign = crypto.createSign('RSA-SHA256');
sign.update(signingString);
const signature = sign.sign(privateKey, 'base64');

const authHeader = `Signature version="1",keyId="${tenancy}/${user}/${fingerprint}",algorithm="rsa-sha256",headers="date (request-target) host",signature="${signature}"`;

const options = {
  hostname: host,
  path: targetPath,
  method: 'GET',
  headers: {
    'date': date,
    'host': host,
    'authorization': authHeader
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status code:', res.statusCode);
    let parsed = null;
    let isJson = false;
    try {
      parsed = JSON.parse(data);
      isJson = true;
      console.log('Response JSON:', JSON.stringify(parsed, null, 2));
    } catch {
      console.log('Response Raw:', data);
    }

    assert('OCI signature accepted (HTTP non-401)', res.statusCode !== 401, `Status: ${res.statusCode}`);
    assert('Response is parseable JSON', isJson === true, `Raw body: ${data.slice(0, 100)}`);
    assert(
      'Tenancy compartment query handled by OCI API',
      res.statusCode === 200 || (res.statusCode === 404 && parsed && parsed.code === 'NotAuthorizedOrNotFound'),
      `Status: ${res.statusCode}, parsed: ${JSON.stringify(parsed)}`
    );

    console.log(`\nTEST SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('[OCI Diagnostic] Request error:', err.message);
  process.exit(1);
});

req.end();
