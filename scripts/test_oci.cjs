const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const path = require('path');

const tenancy = 'ocid1.tenancy.oc1..aaaaaaaazyu5j7lgqitg44n4cbakqkee3i3ons5dueznfzkcwl7cq6tojfoa';
const user = 'ocid1.user.oc1..aaaaaaaap4grec5k4lphrspjkixnwnlsin6h5ky4iqpgblva2rvu4ixjtduq';
const fingerprint = 'd7:20:8d:01:67:a0:fb:12:0a:b3:65:fe:3d:1b:50:ce';
const region = 'ap-singapore-1';
const privateKeyPath = path.join(process.env.USERPROFILE, '.oci', 'oci_api_key.pem');

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
  });
});
req.on('error', err => console.error(err));
req.end();
