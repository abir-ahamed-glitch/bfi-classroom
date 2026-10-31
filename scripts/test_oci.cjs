const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const path = require('path');

const tenancy = process.env.OCI_TENANCY_OCID;
const user = process.env.OCI_USER_OCID;
const fingerprint = process.env.OCI_FINGERPRINT;
const region = process.env.OCI_REGION || 'ap-singapore-1';

const missing = [];
if (!tenancy) missing.push('OCI_TENANCY_OCID');
if (!user) missing.push('OCI_USER_OCID');
if (!fingerprint) missing.push('OCI_FINGERPRINT');

if (missing.length > 0) {
  console.log(`[OCI Diagnostic] Skipping live OCI API call: Missing required environment variable(s): ${missing.join(', ')}`);
  console.log('[OCI Diagnostic] Set OCI_TENANCY_OCID, OCI_USER_OCID, and OCI_FINGERPRINT to execute authenticated probe.');
  process.exit(0);
}

const baseDir = process.env.USERPROFILE || process.env.HOME || '';
const privateKeyPath = process.env.OCI_KEY_PATH || path.join(baseDir, '.oci', 'oci_api_key.pem');

if (!fs.existsSync(privateKeyPath)) {
  console.log(`[OCI Diagnostic] Private key file not found at: ${privateKeyPath}`);
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
    try {
      console.log('Response JSON:', JSON.stringify(JSON.parse(data), null, 2));
    } catch {
      console.log('Response Raw:', data);
    }
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('[OCI Diagnostic] Request error:', err.message);
  process.exit(0);
});

req.end();
