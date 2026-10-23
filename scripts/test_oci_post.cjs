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

const subnetId = 'ocid1.subnet.oc1.ap-singapore-1.aaaaaaaapm5di7xc4xlnqaipv5fdh32adcq4yq3z3y3p3bhl3wdrtj3qomka';
const imageId = 'ocid1.image.oc1.ap-singapore-1.aaaaaaaa4rgzowsv4u6hk6ugkk2be7ztbowlxwnonuvsxq4d73yjy4fc22ka';
const adName = 'lnKN:AP-SINGAPORE-1-AD-1';
const sshKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIR7sVKOeXX/3WrVjtVnidD7GYu8WGYErKK3UbwB5PYQ bfi-classroom-oracle';

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
    console.log('Response:', data);
  });
});
req.on('error', err => console.error(err));
req.write(body);
req.end();
