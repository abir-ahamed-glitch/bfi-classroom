import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyZoomWebhook, createZoomValidationResponse } from '../server/services/zoomWebhookSecurity.js';

test('accepts a signed fresh raw webhook and rejects tampering, stale timestamps and malformed signatures', () => {
  const secret = 'fixture-secret';
  const timestamp = '1700000000';
  const body = Buffer.from('{"event":"meeting.participant_joined"}');
  const sign = value => `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:`).update(value).digest('hex')}`;
  assert.equal(verifyZoomWebhook({secret, timestamp, signature: sign(body), rawBody: body, now: 1700000000}), true);
  assert.equal(verifyZoomWebhook({secret, timestamp, signature: sign(body), rawBody: Buffer.from('{}'), now: 1700000000}), false);
  assert.equal(verifyZoomWebhook({secret, timestamp, signature: sign(body), rawBody: body, now: 1700000400}), false);
  assert.equal(verifyZoomWebhook({secret, timestamp, signature: 'v0=abc', rawBody: body, now: 1700000000}), false);
  assert.equal(verifyZoomWebhook({secret: '', timestamp, signature: sign(body), rawBody: body, now: 1700000000}), false);
});

test('validates Zoom challenge without exposing its secret', () => {
  const result = createZoomValidationResponse('fixture-secret', 'challenge');
  assert.equal(result.plainToken, 'challenge');
  assert.equal(result.encryptedToken, crypto.createHmac('sha256', 'fixture-secret').update('challenge').digest('hex'));
  assert.throws(() => createZoomValidationResponse('', 'challenge'));
});
