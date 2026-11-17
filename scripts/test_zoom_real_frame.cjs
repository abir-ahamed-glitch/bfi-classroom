const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert/strict');

(async () => {
  const parent = express(), outsider = express();
  const {createZoomEmbedServer} = await import('../zoom-embed/host.js');
  const child = createZoomEmbedServer({root:path.resolve(__dirname,'../zoom-embed/dist'),parentOrigin:'http://127.0.0.1:48801',allowLocalTesting:true});
  parent.get('/', (_req,res) => res.send(`<!doctype html><p id="status">waiting</p><iframe id="zoom" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" src="http://127.0.0.1:48802/index.html"></iframe><script>const frame=document.querySelector('iframe');window.addEventListener('message',e=>{if(e.origin!=='http://127.0.0.1:48802'||e.source!==frame.contentWindow)return;if(e.data.type==='BFI_ZOOM_READY'){document.querySelector('#status').textContent='ready';frame.contentWindow.postMessage({type:'BFI_ZOOM_JOIN',signature:'test-signature',meetingNumber:'123456789',password:'',userName:'Test Student'},'http://127.0.0.1:48802')}});frame.onload=()=>frame.contentWindow.postMessage({type:'BFI_ZOOM_PING'},'http://127.0.0.1:48802');</script>`));
  outsider.get('/', (_req,res) => res.send('<!doctype html><iframe id="foreign" src="http://127.0.0.1:48802/index.html"></iframe>'));
  const servers = [];
  let browser;
  try {
    for (const [app,port] of [[parent,48801],[child,48802],[outsider,48803]]) servers.push(await new Promise((resolve,reject)=>{const server=app.listen(port,'127.0.0.1',()=>resolve(server));server.on('error',reject)}));
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    const exceptions=[]; page.on('pageerror',error=>exceptions.push(error.message));
    await page.goto('http://127.0.0.1:48801/');
    const headers = await page.request.get('http://127.0.0.1:48802/index.html');
    assert.match(headers.headers()['content-security-policy'], /frame-ancestors http:\/\/127\.0\.0\.1:48801/);
    await page.getByText('ready',{exact:true}).waitFor({timeout:20000});
    const frame=page.frameLocator('#zoom');
    await frame.getByText(/Connecting to Zoom|Could not initialize Zoom|Could not join the meeting/).waitFor({timeout:20000});
    assert.ok(!exceptions.some(message=>message.includes('sessionStorage')), JSON.stringify(exceptions));
    const otherPage = await browser.newPage();
    const blocked = otherPage.waitForEvent('console', {predicate:message => message.type()==='error' && /frame-ancestors/i.test(message.text()), timeout:10000});
    await otherPage.goto('http://127.0.0.1:48803/');
    assert.ok(await blocked, 'An unrelated origin must be blocked by frame-ancestors');
    await otherPage.close();
    console.log('PASS: real Zoom SDK loads in a separately hosted iframe and receives the selected meeting handshake; no live Zoom meeting was joined');
  } finally { if(browser) await browser.close(); await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve)))); }
})().catch(error=>{console.error(error);process.exitCode=1});
