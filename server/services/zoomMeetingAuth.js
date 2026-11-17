import jwt from 'jsonwebtoken';

export function parseZoomMeetingUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^(?:[a-z0-9-]+\.)*zoom\.us$/i.test(url.hostname)) return null;
    const match = /^\/j\/(\d{9,11})\/?$/.exec(url.pathname);
    if (!match) return null;
    const password = url.searchParams.get('pwd') || '';
    if (password.length > 256) return null;
    return {meetingNumber: match[1], password};
  } catch { return null; }
}

export function createParticipantToken({clientId, clientSecret, meetingNumber, now = Math.floor(Date.now() / 1000)}) {
  if (typeof clientId !== 'string' || !clientId.trim() || typeof clientSecret !== 'string' || !clientSecret.trim() || !/^\d{9,11}$/.test(meetingNumber) || !Number.isInteger(now)) throw new Error('Invalid Zoom SDK configuration.');
  const iat = now - 30;
  const exp = iat + 3600;
  return jwt.sign({appKey: clientId, mn: meetingNumber, role: 0, iat, exp, tokenExp: exp}, clientSecret, {algorithm: 'HS256'});
}
