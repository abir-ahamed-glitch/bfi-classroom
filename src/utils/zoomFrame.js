export function safeZoomOrigin(value, parentOrigin) {
  try {
    const url = new URL(value);
    const parent = new URL(parentOrigin);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname) && parent.protocol === 'http:' && parent.hostname === url.hostname;
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.origin === parentOrigin || url.origin !== value || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

export function validZoomReadyMessage(event, frameWindow, expectedOrigin) {
  return Boolean(frameWindow && expectedOrigin && event.source === frameWindow && event.origin === expectedOrigin && event.data?.type === 'BFI_ZOOM_READY');
}

export function validZoomLeftMessage(event, frameWindow, expectedOrigin) {
  return Boolean(frameWindow && expectedOrigin && event.source === frameWindow && event.origin === expectedOrigin && event.data?.type === 'BFI_ZOOM_LEFT');
}
