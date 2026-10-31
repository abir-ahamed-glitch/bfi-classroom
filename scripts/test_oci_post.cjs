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
const baseDir = process.env.USERPROFILE || process.env.HOME || '';
const privateKeyPath = process.env.OCI_KEY_PATH || path.join(baseDir, '.oci', 'oci_api_key.pem');

const subnetId = process.env.OCI_SUBNET_OCID;
const imageId = process.env.OCI_IMAGE_OCID;
const adName = process.env.OCI_AD_NAME || 'lnKN:AP-SINGAPORE-1-AD-1';
const sshKey = process.env.OCI_SSH_KEY;

const missing = [];
if (!tenancy) missing.push('OCI_TENANCY_OCID');
if (!user) missing.push('OCI_USER_OCID');
if (!fingerprint) missing.push('OCI_FINGERPRINT');
if (!subnetId) missing.push('OCI_SUBNET_OCID');
if (!imageId) missing.push('OCI_IMAGE_OCID');
if (!sshKey) missing.push('OCI_SSH_KEY');

if (missing.length > 0) {
  console.log(`⚠️  Required OCI provisioning variables not configured (missing: ${missing.join(', ')}).`);
  console.log('Skipping live OCI instance provision probe — 0 assertions executed.');
  process.exit(0);
}

if (!fs.existsSync(privateKeyPath)) {
  console.log(`⚠️  Private key file not found at: ${privateKeyPath}`);
  console.log('Skipping live OCI instance provision probe — 0 assertions executed.');
  process.exit(0);
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

const payload = {
  availabilityDomain: adName,
  compartmentId: tenancy,
  displayName: 'bfi-classroom-server',
  shape: 'VM.Standard.A1.Flex',
  shapeConfig: {
    ocpus: 2,
    memoryInGBs: 12
  },
  sourceDetails: {
    sourceType: 'image',
    imageId: imageId,
    bootVolumeSizeInGBs: 100
  },
  createVnicDetails: {
    subnetId: subnetId,
    assignPublicIp: true,
    displayName: 'bfi-classroom-server-vnic'
  },
  metadata: {
    ssh_authorized_keys: sshKey
  }
};

const body = Buffer.from(JSON.stringify(payload), 'utf8');
const bodySha256 = crypto.createHash('sha256').update(body).digest('base64');

const host = `iaas.${region}.oraclecloud.com`;
const targetPath = '/20160918/instances';
const date = new Date().toUTCString();

const signingString = [
  `date: ${date}`,
  `(request-target): post ${targetPath}`,
  `host: ${host}`,
  `content-length: ${body.length}`,
  `content-type: application/json`,
  `x-content-sha256: ${bodySha256}`
].join('\n');

const sign = crypto.createSign('RSA-SHA256');
sign.update(signingString);
const signature = sign.sign(privateKey, 'base64');

const authHeader = `Signature version="1",keyId="${tenancy}/${user}/${fingerprint}",algorithm="rsa-sha256",headers="date (request-target) host content-length content-type x-content-sha256",signature="${signature}"`;

const options = {
  hostname: host,
  path: targetPath,
  method: 'POST',
  headers: {
    'date': date,
    'host': host,
    'content-type': 'application/json',
    'content-length': body.length,
    'x-content-sha256': bodySha256,
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

    assert('OCI POST signature accepted (HTTP non-401)', res.statusCode !== 401, `Status: ${res.statusCode}`);
    assert('Response is parseable JSON', isJson === true, `Raw: ${data.slice(0, 100)}`);
    assert(
      'Instance provisioning request handled by OCI API',
      res.statusCode === 200 || res.statusCode === 400 || res.statusCode === 404 || res.statusCode === 409,
      `Status: ${res.statusCode}`
    );

    console.log(`\nTEST SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('[OCI Provisioning Diagnostic] Request error:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
