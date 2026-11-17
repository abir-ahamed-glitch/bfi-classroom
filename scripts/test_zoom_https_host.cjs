const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createHash, X509Certificate } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const parent = 'https://classroom.test:48801';
const child = 'https://zoom.test:48802';
const outsider = 'https://outsider.test:48803';

async function realMeetingPayload() {
  if (!process.argv.includes('--real-meeting')) return null;
  const { ZOOM_TEST_CLIENT_ID, ZOOM_TEST_CLIENT_SECRET, ZOOM_TEST_MEETING_NUMBER, ZOOM_TEST_MEETING_PASSCODE } = process.env;
  for (const name of ['ZOOM_TEST_CLIENT_SECRET', 'ZOOM_TEST_MEETING_PASSCODE']) delete process.env[name];
  if (!ZOOM_TEST_CLIENT_ID || !ZOOM_TEST_CLIENT_SECRET || !/^\d{9,11}$/.test(ZOOM_TEST_MEETING_NUMBER || '')) {
    throw new Error('Real Zoom test requires a Meeting SDK client ID, secret, and a 9–11 digit test meeting number.');
  }
  const { createParticipantToken } = await import('../server/services/zoomMeetingAuth.js');
  return {
    type: 'BFI_ZOOM_JOIN',
    meetingNumber: ZOOM_TEST_MEETING_NUMBER,
    password: ZOOM_TEST_MEETING_PASSCODE || '',
    userName: 'BFI Classroom Test',
    signature: createParticipantToken({
      clientId: ZOOM_TEST_CLIENT_ID,
      clientSecret: ZOOM_TEST_CLIENT_SECRET,
      meetingNumber: ZOOM_TEST_MEETING_NUMBER
    })
  };
}

async function run() {
  const meeting = await realMeetingPayload();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bfi-zoom-tls-'));
  const servers = [];
  let browser;
  let nginx;
  async function listen(server, port) {
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    return server.address().port;
  }
  try {
    const keyFile = path.join(temporary, 'key.pem');
    const certFile = path.join(temporary, 'cert.pem');
    execFileSync(process.env.ZOOM_TEST_OPENSSL || 'openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=classroom.test', '-addext', 'subjectAltName=DNS:classroom.test,DNS:zoom.test,DNS:outsider.test',
      '-keyout', keyFile, '-out', certFile
    ], {stdio: 'pipe'});
    const cert = fs.readFileSync(certFile);
    const tls = {cert, key: fs.readFileSync(keyFile), minVersion: 'TLSv1.2'};
    const publicKey = new X509Certificate(cert).publicKey.export({type: 'spki', format: 'der'});
    const fingerprint = createHash('sha256').update(publicKey).digest('base64');
    const { createZoomEmbedServer } = await import('../zoom-embed/host.js');
    const host = createZoomEmbedServer({root: path.resolve(__dirname, '../zoom-embed/dist'), parentOrigin: parent});
    const port = await listen(host, 0);
    if (process.env.ZOOM_TEST_NGINX) {
      const config = fs.readFileSync(path.resolve(__dirname, '../docs/infrastructure/nginx-zoom-embed.conf.example'), 'utf8')
        .replace(/^\s*listen \[::\]:.*;\r?$/gm, '')
        .replace('listen 80;', 'listen 127.0.0.1:48804;')
        .replace('listen 443 ssl;', 'listen 127.0.0.1:48802 ssl;')
        .replaceAll('zoom-embed.example.net', 'zoom.test')
        .replace('https://zoom.test$request_uri', 'https://zoom.test:48802$request_uri')
        .replace('/etc/ssl/certs/zoom-classroom.crt', 'cert.pem')
        .replace('/etc/ssl/private/zoom-classroom.key', 'key.pem')
        .replace('127.0.0.1:3098', `127.0.0.1:${port}`);
      fs.writeFileSync(path.join(temporary, 'nginx.conf'), `daemon off; error_log stderr; pid nginx.pid; events {} http {
        access_log off;
        client_body_temp_path client_body_temp;
        proxy_temp_path proxy_temp;
        fastcgi_temp_path fastcgi_temp;
        uwsgi_temp_path uwsgi_temp;
        scgi_temp_path scgi_temp;
        types { text/javascript js; text/html html; }
        ${config}
      }`);
      const args = ['-p', temporary.replaceAll('\\', '/') + '/', '-c', 'nginx.conf', '-e', 'stderr'];
      execFileSync(process.env.ZOOM_TEST_NGINX, [...args, '-t'], {stdio:'inherit'});
      const processHandle = spawn(process.env.ZOOM_TEST_NGINX, args, {stdio:'inherit', windowsHide:true});
      nginx = args;
      let response;
      for (let attempt = 0; attempt < 30 && !response && processHandle.exitCode === null; attempt++) {
        response = await fetch('http://127.0.0.1:48804/index.html', {redirect:'manual'}).catch(() => null);
        if (!response) await delay(100);
      }
      assert.ok(response, 'Nginx did not start its local HTTP listener');
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), child + '/index.html');
    } else await listen(https.createServer(tls, (req, res) => {
      const request = http.request({host: '127.0.0.1', port, path: req.url, method: req.method}, upstream => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      });
      request.on('error', () => { res.writeHead(502); res.end(); });
      request.end();
    }), 48802);
    await listen(https.createServer(tls, (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', `default-src 'none'; frame-src ${child}; script-src 'nonce-test'; style-src 'nonce-test'`);
      res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
        <style nonce="test">body{margin:0} iframe{display:block;width:100%;height:calc(100vh - 40px);border:0} p{margin:8px}</style>
        <iframe title="Zoom" src="${child}/index.html"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
        allow="camera; microphone; display-capture; fullscreen"></iframe>
        <p id="status">waiting</p><script nonce="test">
        const frame = document.querySelector('iframe');
        frame.onload = () => frame.contentWindow.postMessage({type:'BFI_ZOOM_PING'}, '${child}');
        window.addEventListener('message', e => {
          if (e.origin === '${child}' && e.source === frame.contentWindow && e.data.type === 'BFI_ZOOM_READY') {
            document.querySelector('#status').textContent = 'ready';
          }
        });
        </script>`);
    }), 48801);
    await listen(https.createServer(tls, (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<iframe src="${child}/index.html"></iframe>`);
    }), 48803);
    browser = await chromium.launch({headless: !meeting, args: [
      '--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server',
      `--ignore-certificate-errors-spki-list=${fingerprint}`,
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'
    ]});
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.bfiZoomBlockedResources = [];
      document.addEventListener('securitypolicyviolation', event => {
        let origin;
        try { origin = new URL(event.blockedURI).origin; }
        catch { origin = ['inline', 'eval', 'wasm-eval'].includes(event.blockedURI) ? event.blockedURI : null; }
        if (origin && window.bfiZoomBlockedResources.length < 20) {
          window.bfiZoomBlockedResources.push({directive: event.effectiveDirective, origin});
        }
      });
    });
    await page.goto(parent);
    await page.getByText('ready', {exact: true}).waitFor({timeout: 10000});
    const frame = page.frames().find(frame => frame.url() === `${child}/index.html`);
    assert.ok(frame);
    assert.deepEqual(await frame.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
      const settings = {secure: isSecureContext, audio: stream.getAudioTracks().length, video: stream.getVideoTracks().length};
      stream.getTracks().forEach(track => track.stop());
      return settings;
    }), {secure: true, audio: 1, video: 1});
    const other = await browser.newPage();
    const blocked = other.waitForEvent('console', {
      predicate: message => message.type() === 'error' && /frame-ancestors/i.test(message.text()), timeout: 10000
    });
    await other.goto(outsider);
    await blocked;
    await other.close();
    await page.bringToFront();
    const panel = await page.locator('iframe').boundingBox();
    assert.ok(panel && panel.width >= 640 && panel.height >= 500, 'The meeting preview must be large enough to reach its controls.');
    console.log(`PASS: ${nginx ? 'Nginx HTTPS and redirect, ' : ''}frame isolation, SDK handshake and browser camera/microphone permissions using simulated devices.`);
    if (meeting) {
      await page.evaluate(({payload, origin}) => {
        document.querySelector('iframe').contentWindow.postMessage(payload, origin);
      }, {payload: meeting, origin: child});
      let timedOut = false;
      try {
        await frame.waitForFunction(() => {
          const status = document.querySelector('#status')?.textContent;
          return status === '' || status?.startsWith('Could not ');
        }, null, {timeout: 120000});
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        timedOut = true;
      }
      const result = await frame.locator('#status').evaluate(element => ({
        joined: element.textContent === '',
        stage: element.dataset.zoomStage || null,
        code: element.dataset.zoomErrorCode || null,
        blocked: window.bfiZoomBlockedResources,
        waitingForHost: /waiting for (?:the )?host|host .*start this meeting/i.test(document.body.innerText),
        waitingRoom: /waiting room|host .*let you in/i.test(document.body.innerText)
      }));
      const summary = {...result, timedOut};
      if (process.env.ZOOM_TEST_RESULT_FILE) {
        fs.writeFileSync(process.env.ZOOM_TEST_RESULT_FILE, JSON.stringify(summary, null, 2));
      }
      if (!result.joined) throw new Error(`The Zoom SDK did not confirm a meeting join. Diagnostic: ${JSON.stringify(summary)}`);
      console.log('PASS: Zoom SDK reported successful join to the BFI test meeting.');
    }
  } finally {
    if (browser) await browser.close();
    if (nginx && fs.existsSync(path.join(temporary, 'nginx.pid'))) {
      execFileSync(process.env.ZOOM_TEST_NGINX, [...nginx, '-s', 'stop'], {stdio:'ignore', windowsHide:true});
      for (let attempt = 0; attempt < 30 && fs.existsSync(path.join(temporary, 'nginx.pid')); attempt++) await delay(100);
    }
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    for (const name of ['key.pem', 'cert.pem', 'nginx.conf', 'nginx.pid']) fs.rmSync(path.join(temporary, name), {force: true});
    // Nginx can create empty request-body and proxy cache directories.
    for (const name of ['client_body_temp', 'proxy_temp', 'fastcgi_temp', 'uwsgi_temp', 'scgi_temp']) {
      const directory = path.join(temporary, name);
      if (fs.existsSync(directory)) fs.rmdirSync(directory);
    }
    fs.rmdirSync(temporary);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
