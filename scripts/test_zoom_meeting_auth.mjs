import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createParticipantToken, parseZoomMeetingUrl } from '../server/services/zoomMeetingAuth.js';

test('accepts only Zoom meeting URLs and preserves meeting passcode', () => {
  assert.deepEqual(parseZoomMeetingUrl('https://us02web.zoom.us/j/12345678901?pwd=abc123'), {meetingNumber:'12345678901', password:'abc123'});
  for (const url of ['https://zoom.us.evil.test/j/123456789', 'http://zoom.us/j/123456789', 'https://evil.test/j/123456789', 'https://zoom.us/j/not-a-number']) assert.equal(parseZoomMeetingUrl(url), null);
});

test('signs a participant-only short-lived Zoom SDK token', () => {
  const token = createParticipantToken({clientId:'test-client', clientSecret:'test-secret', meetingNumber:'12345678901', now:1700000000});
  const decoded = jwt.verify(token, 'test-secret', {clockTimestamp:1700000000});
  assert.equal(decoded.appKey, 'test-client');
  assert.equal(decoded.mn, '12345678901');
  assert.equal(decoded.role, 0);
  assert.ok(decoded.exp - decoded.iat >= 1800);
  assert.throws(() => createParticipantToken({clientId:'', clientSecret:'test-secret', meetingNumber:'12345678901'}));
  assert.throws(() => createParticipantToken({clientId:'test-client', clientSecret:'', meetingNumber:'12345678901'}));
});
