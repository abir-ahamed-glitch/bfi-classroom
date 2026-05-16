const requestJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
};

const login = (body) => requestJson('http://127.0.0.1:3002/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

const student = await login({ username: 'mdkawsarahamed.gb1s', password: '!^7PF*$M$gfk', type: 'student' });
const admin = await login({ username: 'admin', password: 'Admin@BFI2024', type: 'admin' });
const studentHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${student.token}` };
const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` };

const sent = await requestJson('http://127.0.0.1:3002/api/inbox/messages', { method: 'POST', headers: studentHeaders, body: JSON.stringify({ receiver_id: 1, content: 'Smoke base message' }) });
const reply = await requestJson('http://127.0.0.1:3002/api/inbox/messages', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ receiver_id: 14, content: 'Smoke reply', reply_to_message_id: sent.sent_message.id }) });
const reacted = await requestJson(`http://127.0.0.1:3002/api/inbox/messages/${sent.sent_message.id}/reactions`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ reaction: '??' }) });
const edited = await requestJson(`http://127.0.0.1:3002/api/inbox/messages/${sent.sent_message.id}`, { method: 'PUT', headers: studentHeaders, body: JSON.stringify({ content: 'Smoke base message edited' }) });
const forwarded = await requestJson('http://127.0.0.1:3002/api/inbox/messages', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ receiver_id: 14, forwarded_from_message_id: sent.sent_message.id }) });

const form = new FormData();
form.append('receiver_id', '1');
form.append('content', 'File payload');
form.append('attachment', new Blob(['hello from codex'], { type: 'text/plain' }), 'smoke.txt');
const uploadRes = await fetch('http://127.0.0.1:3002/api/inbox/messages/upload', { method: 'POST', headers: { Authorization: `Bearer ${student.token}` }, body: form });
const uploaded = await uploadRes.json();
if (!uploadRes.ok) throw new Error(`upload ${uploadRes.status} ${JSON.stringify(uploaded)}`);

const studentView = await requestJson('http://127.0.0.1:3002/api/inbox/messages/1', { headers: { Authorization: `Bearer ${student.token}` } });
const replySeen = studentView.messages.find((m) => m.id === reply.sent_message.id);
const forwardSeen = studentView.messages.find((m) => m.id === forwarded.sent_message.id);
const uploadSeen = studentView.messages.find((m) => m.id === uploaded.sent_message.id);

const deleteForMe = await requestJson(`http://127.0.0.1:3002/api/inbox/messages/${reply.sent_message.id}?mode=me`, { method: 'DELETE', headers: { Authorization: `Bearer ${student.token}` } });
const unsend = await requestJson(`http://127.0.0.1:3002/api/inbox/messages/${forwarded.sent_message.id}?mode=everyone`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin.token}` } });
const deleteConversation = await requestJson('http://127.0.0.1:3002/api/inbox/conversations/1', { method: 'DELETE', headers: { Authorization: `Bearer ${student.token}` } });

console.log(JSON.stringify({
  replyHasPreview: !!replySeen?.reply_preview,
  reactionCount: reacted.updated_message.reactions?.[0]?.count || 0,
  editedFlag: !!edited.updated_message?.is_edited,
  forwardFlagVisible: !!forwardSeen?.is_forwarded,
  uploadHasAttachment: !!uploadSeen?.attachment_url,
  deleteForMeMessage: deleteForMe.message,
  unsendMessage: unsend.message,
  deleteConversationMessage: deleteConversation.message
}, null, 2));
