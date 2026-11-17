import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZoomEmbedServer } from './host.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.ZOOM_EMBED_PORT || 3098);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ZOOM_EMBED_PORT');
const server = createZoomEmbedServer({root, parentOrigin: process.env.ZOOM_PARENT_ORIGIN});
server.listen(port, '127.0.0.1', () => console.log(`Zoom embed listening on loopback port ${port}`));
