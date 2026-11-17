import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createZoomEmbedServer} from '../zoom-embed/host.js';

test('serves only known files with isolated policy and exact parent origin', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zoom-host-'));
  fs.writeFileSync(path.join(root,'index.html'),'<h1>test</h1>');
  fs.mkdirSync(path.join(root,'assets'));
  fs.writeFileSync(path.join(root,'assets','main.js'),'ok');
  const server=createZoomEmbedServer({root,parentOrigin:'https://classroom.example'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    const page=await fetch(base+'/index.html');
    assert.equal(page.status,200);
    assert.match(page.headers.get('content-security-policy'),/frame-ancestors https:\/\/classroom\.example/);
    const mediaPolicy = page.headers.get('content-security-policy').split(';').find(rule => rule.trim().startsWith('media-src'));
    assert.deepEqual(mediaPolicy.trim().split(/\s+/), ['media-src', "'self'", 'blob:', 'https://source.zoom.us']);
    assert.equal(page.headers.get('x-content-type-options'),'nosniff');
    assert.equal((await fetch(base+'/assets/main.js')).status,200);
    assert.equal((await fetch(base+'/unknown')).status,404);
    assert.equal((await fetch(base+'/index.html',{method:'POST'})).status,405);
    assert.throws(()=>createZoomEmbedServer({root,parentOrigin:'https://bad.example/path'}));
    for (const parentOrigin of ['https://127.0.0.1','https://localhost','https://foo.localhost']) {
      assert.throws(()=>createZoomEmbedServer({root,parentOrigin}));
    }
  } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
