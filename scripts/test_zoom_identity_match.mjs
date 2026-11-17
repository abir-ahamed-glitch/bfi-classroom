import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveVerifiedZoomParticipant} from '../server/services/zoomIdentityMatch.js';

const event={meetingInstance:'instance-a',participantId:'participant-1'};
const verified={meetingInstance:'instance-a',participantId:'participant-1',enrollmentId:10,classId:'class-1',verification:'operator_verified'};
test('requires exactly one explicitly verified meeting-scoped identity', () => {
  assert.deepEqual(resolveVerifiedZoomParticipant(event,[verified]),{enrollmentId:10,classId:'class-1'});
  assert.equal(resolveVerifiedZoomParticipant(event,[]),null);
  assert.equal(resolveVerifiedZoomParticipant(event,[{...verified,meetingInstance:'instance-b'}]),null);
  assert.equal(resolveVerifiedZoomParticipant(event,[{...verified,verification:'display_name'}]),null);
  assert.equal(resolveVerifiedZoomParticipant(event,[verified,{...verified,enrollmentId:11}]),null);
  assert.equal(resolveVerifiedZoomParticipant({...event,participantId:''},[verified]),null);
});
