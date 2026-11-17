import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export function createZoomEmbedServer({root, parentOrigin, allowLocalTesting = false}) {
  let parent;
  try { parent = new URL(parentOrigin); } catch { throw new Error('Invalid parent origin.'); }
  const local = allowLocalTesting && parent.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parent.hostname);
  const hostname = parent.hostname.replace(/^\[|\]$/g, '');
  const publicHttps = parent.protocol === 'https:' && !net.isIP(hostname) && hostname !== 'localhost' && !hostname.endsWith('.localhost');
  if (parent.origin !== parentOrigin || parent.username || parent.password || (!publicHttps && !local)) throw new Error('Invalid parent origin.');
  const rootPath = fs.realpathSync(root);
  const policy = ["default-src 'self'", "base-uri 'none'", "object-src 'none'", `frame-ancestors ${parent.origin}`,
    "script-src 'self' 'unsafe-eval' blob: https://source.zoom.us https://*.zoom.us",
    "style-src 'self' 'unsafe-inline' https://source.zoom.us",
    "connect-src 'self' https://zoom.us https://*.zoom.us wss://*.zoom.us https://*.zoom.com wss://*.zoom.com",
    "img-src 'self' data: blob: https://*.zoom.us", "media-src 'self' blob: https://source.zoom.us", "font-src 'self' data:", "worker-src 'self' blob:"].join('; ');
  const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
  return http.createServer((req,res) => {
    res.setHeader('Content-Security-Policy', policy);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);return res.end();}
    let pathname;
    try {pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);} catch {res.writeHead(400);return res.end();}
    if (pathname === '/') pathname='/index.html';
    if (pathname !== '/index.html' && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname)) {res.writeHead(404);return res.end();}
    try {
      const file = fs.realpathSync(path.join(rootPath,pathname.slice(1)));
      if (!file.startsWith(rootPath + path.sep) || !fs.statSync(file).isFile()) throw new Error('Not a file');
      const type = types[path.extname(file).toLowerCase()];
      if (!type) throw new Error('Unsupported file');
      res.writeHead(200,{'Content-Type':type,'Cache-Control':pathname === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable'});
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    } catch {res.writeHead(404);res.end();}
  });
}
