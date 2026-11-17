export function validJoinMessage(event, expectedOrigin, expectedParent) {
  const data = event?.data;
  return event?.origin === expectedOrigin && event?.source === expectedParent && data?.type === 'BFI_ZOOM_JOIN'
    && typeof data.signature === 'string' && data.signature.length > 0 && /^\d{9,11}$/.test(data.meetingNumber)
    && typeof data.password === 'string' && typeof data.userName === 'string' && Boolean(data.userName.trim());
}
