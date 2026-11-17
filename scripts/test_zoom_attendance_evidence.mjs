import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeZoomAttendance} from '../server/services/zoomAttendanceEvidence.js';

test('pairs joins and leaves per participant without double counting reconnects', () => {
  const events = [
    {type:'leave', participantId:'p1', at:'2026-11-16T13:40:00Z'},
    {type:'join', participantId:'p1', at:'2026-11-16T13:00:00Z'},
    {type:'join', participantId:'p1', at:'2026-11-16T13:00:00Z'},
    {type:'join', participantId:'p1', at:'2026-11-16T13:30:00Z'},
    {type:'leave', participantId:'p1', at:'2026-11-16T14:00:00Z'}
  ];
  const result = summarizeZoomAttendance(events, {start:'2026-11-16T13:00:00Z', end:'2026-11-16T15:00:00Z'});
  assert.equal(result.seconds,3600);
  assert.equal(result.incomplete,false);
});

test('unknown or unmatched events never imply complete evidence', () => {
  const bounds = {start:'2026-11-16T13:00:00Z', end:'2026-11-16T15:00:00Z'};
  assert.equal(summarizeZoomAttendance([{type:'join',participantId:'p',at:'2026-11-16T13:00:00Z'}],bounds).incomplete,true);
  assert.equal(summarizeZoomAttendance([{type:'leave',participantId:'p',at:'2026-11-16T13:00:00Z'}],bounds).incomplete,true);
  assert.throws(()=>summarizeZoomAttendance([{type:'join',participantId:'',at:'invalid'}],bounds));
  assert.throws(()=>summarizeZoomAttendance([{type:'join',participantId:'p1',at:bounds.start},{type:'join',participantId:'p2',at:bounds.start}],bounds));
  assert.throws(()=>summarizeZoomAttendance([], {start:'invalid',end:'invalid'}));
});
