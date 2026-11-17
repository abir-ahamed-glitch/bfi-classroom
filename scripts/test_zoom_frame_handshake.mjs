import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validJoinMessage } from '../zoom-embed/src/validation.js';
import { validZoomReadyMessage, safeZoomOrigin } from '../src/utils/zoomFrame.js';

test('only accepts the parent origin and a well-formed participant payload', () => {
  const parent = {};
  const data = {type:'BFI_ZOOM_JOIN',signature:'signed-token',meetingNumber:'123456789',password:'pass',userName:'Student'};
  assert.equal(validJoinMessage({origin:'https://classroom.example',source:parent,data}, 'https://classroom.example', parent), true);
  assert.equal(validJoinMessage({origin:'https://evil.example',source:parent,data}, 'https://classroom.example', parent), false);
  assert.equal(validJoinMessage({origin:'https://classroom.example',source:{},data}, 'https://classroom.example', parent), false);
  assert.equal(validJoinMessage({origin:'https://classroom.example',source:parent,data:{...data,meetingNumber:'not-number'}}, 'https://classroom.example', parent), false);
});

test('parent accepts readiness only from its own separately hosted frame', () => {
  const frame = {};
  const origin = 'https://zoom.example';
  assert.equal(validZoomReadyMessage({origin,source:frame,data:{type:'BFI_ZOOM_READY'}}, frame, origin), true);
  assert.equal(validZoomReadyMessage({origin,source:{},data:{type:'BFI_ZOOM_READY'}}, frame, origin), false);
  assert.equal(validZoomReadyMessage({origin:'https://evil.example',source:frame,data:{type:'BFI_ZOOM_READY'}}, frame, origin), false);
  assert.equal(safeZoomOrigin('https://zoom.example', 'https://classroom.example'), origin);
  assert.equal(safeZoomOrigin('https://classroom.example', 'https://classroom.example'), null);
  assert.equal(safeZoomOrigin('http://evil.example', 'https://classroom.example'), null);
  assert.equal(safeZoomOrigin('http://127.0.0.1:48802', 'https://classroom.example'), null);
  assert.equal(safeZoomOrigin('http://127.0.0.1:48802', 'http://127.0.0.1:48801'), 'http://127.0.0.1:48802');
  assert.equal(safeZoomOrigin('https://zoom.example/path', 'https://classroom.example'), null);
});
