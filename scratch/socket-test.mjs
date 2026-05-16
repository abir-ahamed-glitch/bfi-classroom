import { io } from 'socket.io-client';

const login = async (body) => {
  const res = await fetch('http://127.0.0.1:3002/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

const student = await login({ username: 'mdkawsarahamed.gb1s', password: '!^7PF*$M$gfk', type: 'student' });
const admin = await login({ username: 'admin', password: 'Admin@BFI2024', type: 'admin' });

const events = [];
const adminSocket = io('http://127.0.0.1:3002', { auth: { token: admin.token }, transports: ['websocket', 'polling'] });
const studentSocket = io('http://127.0.0.1:3002', { auth: { token: student.token }, transports: ['websocket', 'polling'] });

await new Promise((resolve, reject) => {
  let connected = 0;
  const timer = setTimeout(() => reject(new Error('socket timeout')), 5000);
  const mark = () => {
    connected += 1;
    if (connected === 2) {
      clearTimeout(timer);
      resolve();
    }
  };
  adminSocket.on('connect', mark);
  studentSocket.on('connect', mark);
  adminSocket.on('connect_error', reject);
  studentSocket.on('connect_error', reject);
});

adminSocket.on('inbox:message', (payload) => { events.push({ side: 'admin', payload }); });
studentSocket.on('inbox:message', (payload) => { events.push({ side: 'student', payload }); });

const sendRes = await fetch('http://127.0.0.1:3002/api/inbox/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${student.token}`,
  },
  body: JSON.stringify({ receiver_id: 1, content: 'socket delivery retest' }),
});
const sendData = await sendRes.json();
await new Promise((resolve) => setTimeout(resolve, 1200));
console.log(JSON.stringify({ sentId: sendData?.sent_message?.id, eventCount: events.length, adminGotEvent: events.some((x) => x.side === 'admin'), studentGotEvent: events.some((x) => x.side === 'student') }, null, 2));
adminSocket.disconnect();
studentSocket.disconnect();
