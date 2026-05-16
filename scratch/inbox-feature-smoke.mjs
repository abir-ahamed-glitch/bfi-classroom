const requestJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`${res.status} ${JSON.stringify(data)}`);
  }
  return data;
};

const login = (body) => requestJson('http://127.0.0.1:3002/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

const student = await login({ username: 'mdkawsarahamed.gb1s', password: '!^7PF*$M$gfk', type: 'student' });
const admin = await login({ username: 'admin', password: 'Admin@BFI2024', type: 'admin' });

const studentHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${student.token}` };
const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` };

const sendOne = await requestJson('http://127.0.0.1:3002/api/inbox/messages', { method: 'POST', headers: studentHeaders, body: JSON.stringify({ receiver_id: 1, content: 'Feature smoke hello' }) });
const reply = await requestJson('http://127.0.0.1:3002/api/inbox/messages', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ receiver_id: 14, content: 'Replying back', reply_to_message_id: sendOne.sent_message.id }) });
const react = await requestJson(`http://127.0.0.1:3002/api/inbox/messages/${sendOne.sent_message.id}/reactions`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ reaction: '??' }) });
const edit = await requestJson(`http://127.0.0.1:3002/api/inbox/messages/${sendOne.sent_message.id}`, { method: 'PUT', headers: studentHeaders, body: JSON.stringify({ content: 'Feature smoke hello edited' }) });
const forward = await requestJson('http://127.0.0.1:3002/api/inbox/messages', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ receiver_id: 14, forwarded_from_message_id: sendOne.sent_message.id }) });
const removeForMe = await requestJson(`http://127.0.0.1:3002/api/inbox/messages/${reply.sent_message.id}?mode=me`, { method: 'DELETE', headers: { Authorization: `Bearer ${student.token}` } });
const unsend = await requestJson(`http://127.0.0.1:3002/api/inbox/messages/${forward.sent_message.id}?mode=everyone`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin.token}` } });
const convo = await requestJson('http://127.0.0.1:3002/api/inbox/messages/1', { headers: { Authorization: `Bearer ${student.token}` } });

console.log(JSON.stringify({
  sentId: sendOne.sent_message.id,
  replyHasPreview: !!reply.sent_message.reply_preview,
  reactionCount: react.updated_message.reactions?.[0]?.count || 0,
  editEdited: !!edit.updated_message?.is_edited,
  forwardFlag: !!forward.sent_message.is_forwarded,
  removeForMeMessage: removeForMe.message,
  unsendMessage: unsend.message,
  convoCount: convo.messages.length
}, null, 2));
