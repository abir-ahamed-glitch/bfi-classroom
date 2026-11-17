import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredZoomFrameOrigin} from '../server/services/zoomFramePolicy.js';

test('allows only explicitly enabled, distinct HTTPS origins with no paths', () => {
  const env = {ZOOM_EMBED_ENABLED:'true', ZOOM_EMBED_ORIGIN:'https://zoom.example.com', ZOOM_PARENT_ORIGIN:'https://classroom.example.com'};
  assert.equal(configuredZoomFrameOrigin(env),'https://zoom.example.com');
  assert.equal(configuredZoomFrameOrigin({...env,ZOOM_EMBED_ENABLED:'false'}),null);
  assert.equal(configuredZoomFrameOrigin({...env,ZOOM_EMBED_ORIGIN:'https://classroom.example.com'}),null);
  assert.equal(configuredZoomFrameOrigin({...env,ZOOM_EMBED_ORIGIN:'http://127.0.0.1:3000'}),null);
  assert.equal(configuredZoomFrameOrigin({...env,ZOOM_EMBED_ORIGIN:'https://127.0.0.1'}),null);
  assert.equal(configuredZoomFrameOrigin({...env,ZOOM_EMBED_ORIGIN:'https://localhost'}),null);
  assert.equal(configuredZoomFrameOrigin({...env,ZOOM_EMBED_ORIGIN:'https://zoom.example.com/path'}),null);
  assert.equal(configuredZoomFrameOrigin({...env,ZOOM_PARENT_ORIGIN:''}),null);
});
