import { build } from 'vite';
import fs from 'node:fs/promises';
import { zoomEmbedHeaders } from './host.js';

const headers = zoomEmbedHeaders(process.env.VITE_ZOOM_PARENT_ORIGIN);
await build();
const rules = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
await fs.writeFile(new URL('./dist/_headers', import.meta.url),
  ['/*', ...rules, '  ! Access-Control-Allow-Origin', '  X-Robots-Tag: noindex',
    '/', '  Cache-Control: no-store', '/index.html', '  Cache-Control: no-store', ''].join('\n'));
await fs.writeFile(new URL('./dist/404.html', import.meta.url),
  '<!doctype html><meta charset="utf-8"><title>Not found</title><h1>Not found</h1>');
