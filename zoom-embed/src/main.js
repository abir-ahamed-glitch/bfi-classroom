import { ZoomMtg } from '@zoom/meetingsdk';
import { validJoinMessage } from './validation.js';

const status = document.getElementById('status');
const parentOrigin = import.meta.env.VITE_ZOOM_PARENT_ORIGIN;
if (!parentOrigin || parentOrigin === window.location.origin) throw new Error('Zoom parent origin is not configured safely.');

function reportFailure(stage, result, message) {
  status.dataset.zoomStage = stage;
  const code = result?.errorCode;
  if ((typeof code === 'number' || typeof code === 'string') && /^-?\d{1,8}$/.test(String(code))) {
    status.dataset.zoomErrorCode = String(code);
  }
  status.textContent = message;
}

let started = false;
window.addEventListener('message', event => {
  if (event.origin === parentOrigin && event.source === window.parent && event.data?.type === 'BFI_ZOOM_PING') {
    window.parent.postMessage({type:'BFI_ZOOM_READY'}, parentOrigin);
    return;
  }
  if (started || !validJoinMessage(event, parentOrigin, window.parent)) return;
  const { signature, meetingNumber, password, userName } = event.data;
  started = true;
  status.textContent = 'Connecting to Zoom…';
  ZoomMtg.preLoadWasm();
  ZoomMtg.prepareWebSDK();
  ZoomMtg.init({leaveUrl: `${parentOrigin}/bfi-classroom/classroom`, success: () => {
    ZoomMtg.join({signature, meetingNumber, passWord: password, userName, success: () => { status.textContent = ''; },
      error: result => reportFailure('join', result, 'Could not join the meeting. Please try again or use the meeting link.')});
  }, error: result => reportFailure('init', result, 'Could not initialize Zoom. Please try again or use the meeting link.')});
});
window.parent.postMessage({type: 'BFI_ZOOM_READY'}, parentOrigin);
