import net from 'node:net';

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
      && !net.isIP(host) && host !== 'localhost' && !host.endsWith('.localhost') ? url.origin : null;
  } catch { return null; }
}

export function configuredZoomFrameOrigin(env) {
  if (env.ZOOM_EMBED_ENABLED !== 'true') return null;
  const parent = httpsOrigin(env.ZOOM_PARENT_ORIGIN);
  const frame = httpsOrigin(env.ZOOM_EMBED_ORIGIN);
  return parent && frame && parent !== frame ? frame : null;
}
