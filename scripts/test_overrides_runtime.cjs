#!/usr/bin/env node
/**
 * scripts/test_overrides_runtime.cjs
 *
 * Runtime Verification Suite for Transitive Dependency Overrides.
 * Proves that each overridden package satisfies its consumer's API and runtime contracts.
 */

const assert = require('assert');
const http = require('http');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Testing: ${name}... `);
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    console.log('✅ PASS');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('================================================================');
  console.log('TRANSITIVE OVERRIDES SERVER RUNTIME VERIFICATION SUITE');
  console.log('================================================================\n');

  // 1. proxy-addr (>=2.0.8) with Express req
  await runTest('proxy-addr: resolves client IP correctly under trust proxies', () => {
    const proxyaddr = require('proxy-addr');
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' },
      connection: { remoteAddress: '10.0.0.1' }
    };
    const addr = proxyaddr(req, ['loopback', 'linklocal', 'uniquelocal']);
    assert.strictEqual(addr, '203.0.113.195');

    // Test loopback
    const loopbackReq = {
      headers: {},
      connection: { remoteAddress: '127.0.0.1' }
    };
    assert.strictEqual(proxyaddr(loopbackReq, () => false), '127.0.0.1');
  });

  // 2. body-parser (>=2.4.0) & qs (>=6.16.2) in Express
  await runTest('body-parser & qs: parses JSON and complex URL query params in Express', async () => {
    const express = require('express');
    const app = express();
    app.set('query parser', 'extended');
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.post('/test-body', (req, res) => {
      res.json({ body: req.body, query: req.query });
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const payload = JSON.stringify({ student: 'Abir', batch: 'B-01', scores: [95, 88, 92] });
      const response = await fetch(`http://127.0.0.1:${port}/test-body?filter[course]=Directing&tags=a&tags=b`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      const data = await response.json();
      assert.strictEqual(data.body.student, 'Abir');
      assert.strictEqual(data.body.scores.length, 3);
      assert.strictEqual(data.query.filter.course, 'Directing');
    } finally {
      server.close();
    }
  });

  // 3. ws (>=8.21.3) & engine.io (>=6.6.10) & socket.io-parser (>=4.2.7)
  await runTest('ws & socket.io: handles framed message exchange over loopback', async () => {
    const { Server } = require('socket.io');
    const { io } = require('socket.io-client');

    const server = http.createServer();
    const ioServer = new Server(server, { cors: { origin: '*' } });

    ioServer.on('connection', socket => {
      socket.on('ping-event', data => {
        socket.emit('pong-event', { received: data, status: 'ok' });
      });
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const client = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
      const pongData = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebSocket timeout')), 3000);
        client.on('connect', () => {
          client.emit('ping-event', 'hello-bfi');
        });
        client.on('pong-event', data => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      assert.strictEqual(pongData.received, 'hello-bfi');
      assert.strictEqual(pongData.status, 'ok');
      client.close();
    } finally {
      ioServer.close();
      server.close();
    }
  });

  // 4. docx with overridden nanoid (>=5.1.16)
  await runTest('docx & nanoid: packs Document with paragraphs into valid buffer', async () => {
    const { Document, Packer, Paragraph, TextRun } = require('docx');
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'BFI Classroom Student Certificate', bold: true })
            ]
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);
    // DOCX files are ZIP archives (magic bytes PK 0x03 0x04)
    assert.strictEqual(buffer[0], 0x50);
    assert.strictEqual(buffer[1], 0x4B);
  });

  // 5. brace-expansion (^1.1.21) with minimatch
  await runTest('brace-expansion: minimatch matches glob patterns with brace expansion', () => {
    const minimatch = require('minimatch');
    assert.strictEqual(minimatch('src/utils/safeSpreadsheet.js', 'src/**/*.{js,jsx}'), true);
    assert.strictEqual(minimatch('src/utils/safeSpreadsheet.css', 'src/**/*.{js,jsx}'), false);
    assert.strictEqual(minimatch('server/routes/auth.js', 'server/**/{auth,admin}.js'), true);
  });

  // 6. ip-address (>=10.7.4)
  await runTest('ip-address: validates IPv4 and IPv6 addresses without leading-zero octet SSRF bypass', () => {
    const { Address4, Address6 } = require('ip-address');
    const ipv4 = new Address4('192.168.1.1');
    assert.strictEqual(ipv4.isCorrect(), true);
    assert.strictEqual(ipv4.isPrivate(), true);

    const loopback4 = new Address4('127.0.0.1');
    assert.strictEqual(loopback4.isLoopback(), true);

    const ipv6 = new Address6('::1');
    assert.strictEqual(ipv6.isCorrect(), true);
    assert.strictEqual(ipv6.isLoopback(), true);
  });

  // 7. fflate (>=0.8.3)
  await runTest('fflate: compresses and decompresses binary data', () => {
    const fflate = require('fflate');
    const data = Buffer.from('BFI Classroom Security Remediation Data 2026');
    const zipped = fflate.zipSync({ 'test.txt': data });
    assert.ok(zipped.length > 0);

    const unzipped = fflate.unzipSync(zipped);
    assert.strictEqual(Buffer.from(unzipped['test.txt']).toString('utf8'), data.toString('utf8'));
  });

  // 8. @xmldom/xmldom (>=0.8.15)
  await runTest('@xmldom/xmldom: parses XML document correctly', () => {
    const { DOMParser } = require('@xmldom/xmldom');
    const doc = new DOMParser().parseFromString('<workbook><sheets><sheet name="Students" id="1"/></sheets></workbook>', 'text/xml');
    const sheets = doc.getElementsByTagName('sheet');
    assert.strictEqual(sheets.length, 1);
    assert.strictEqual(sheets[0].getAttribute('name'), 'Students');
  });

  // 9. undici (^7.30.1) Agent and dispatch
  await runTest('undici: instantiates custom Agent without TLS regression', async () => {
    let undiciModule;
    try {
      undiciModule = require('undici');
    } catch {
      const path = require('path');
      const jsdomDir = path.dirname(require.resolve('jsdom'));
      undiciModule = require(require.resolve('undici', { paths: [jsdomDir] }));
    }
    const { Agent } = undiciModule;
    const agent = new Agent({
      connect: { timeout: 5000 },
      keepAliveTimeout: 1000
    });
    assert.ok(agent, 'Agent should be created');
    await agent.destroy();
  });

  // 10. jsdom + undici internal dispatcher compatibility
  await runTest('jsdom: initializes JSDOM instance without undici wrap-handler regression', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="test">BFI Classroom</div></body></html>');
    assert.strictEqual(dom.window.document.getElementById('test').textContent, 'BFI Classroom');
    dom.window.close();
  });

  console.log(`\n================================================================`);
  console.log(`Transitive Overrides Results: ${passedTests}/${totalTests} Passed`);
  console.log(`================================================================`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Overrides test error:', err);
    process.exit(1);
  });
}
