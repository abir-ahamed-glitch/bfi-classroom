import crypto from 'node:crypto';

export function verifyZoomWebhook({secret, timestamp, signature, rawBody, now = Math.floor(Date.now() / 1000)}) {
  if (typeof secret !== 'string' || !secret || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp)
    || typeof signature !== 'string' || !/^v0=[a-f0-9]{64}$/.test(signature) || !Buffer.isBuffer(rawBody)
    || !Number.isFinite(now) || Math.abs(now - Number(timestamp)) > 300) return false;
  const hash = crypto.createHmac('sha256', secret).update(`v0:${timestamp}:`).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature.slice(3), 'hex'), Buffer.from(hash, 'hex'));
}

export function createZoomValidationResponse(secret, plainToken) {
  if (typeof secret !== 'string' || !secret || typeof plainToken !== 'string' || !plainToken || plainToken.length > 1024) throw new Error('Invalid Zoom challenge.');
  return {plainToken, encryptedToken: crypto.createHmac('sha256', secret).update(plainToken).digest('hex')};
}
