#!/usr/bin/env node
/**
 * scripts/test_nodemailer_transport.cjs
 *
 * Comprehensive Test Suite for Nodemailer 10.3.0.
 * Verifies transporter configuration, mail option builders, recipient parsing,
 * CRLF injection defense, and SMTP protocol handling using local test transports.
 *
 * CRITICAL CONSTRAINT: ZERO REAL EMAILS ARE SENT OVER THE NETWORK.
 * All tests utilize local stream/JSON transports or an in-process mock SMTP loopback server.
 */

const net = require('net');
const assert = require('assert');
const nodemailer = require('nodemailer');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Testing: ${name}... `);
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    console.log('✅ PASS');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('================================================================');
  console.log('NODEMAILER 10.3.0 TRANSPORT & RECIPIENT REGRESSION SUITE');
  console.log('Testing Engine: Nodemailer 10.3.0 (Isolated Local Transports)');
  console.log('Zero Network Transmission: All Dispatches Confined to Loopback');
  console.log('================================================================\n');

  const emailModule = await import('../server/utils/email.js');

  // 1. Password Reset Mail Options Builder (Self-Service)
  await runTest('buildPasswordResetMailOptions: generates valid self-service HTML & text options', () => {
    const to = 'student@example.com';
    const link = 'https://bfibd.org/bfi-classroom/reset-password?token=abcdef123456';
    const options = emailModule.buildPasswordResetMailOptions(to, link, { isSuperAdminInitiated: false });

    assert.strictEqual(options.to, to);
    assert.strictEqual(options.subject, 'Password Reset Request - BFI Classroom');
    assert.ok(options.html.includes(link), 'HTML must contain reset link');
    assert.ok(options.html.includes('15 minutes'), 'Self-service link expires in 15 minutes');
    assert.ok(options.text.includes(link), 'Text must contain reset link');
    assert.ok(options.from.includes('BFI Classroom'), 'From header formatted correctly');
  });

  // 2. Password Reset Mail Options Builder (Super Admin-Initiated)
  await runTest('buildPasswordResetMailOptions: generates valid Super Admin-initiated options', () => {
    const to = 'admin2@example.com';
    const link = 'https://bfibd.org/bfi-classroom/reset-password?token=adminreset789';
    const options = emailModule.buildPasswordResetMailOptions(to, link, { isSuperAdminInitiated: true });

    assert.strictEqual(options.to, to);
    assert.strictEqual(options.subject, 'Administrative Password Reset - BFI Classroom');
    assert.ok(options.html.includes(link));
    assert.ok(options.html.includes('30 minutes'), 'Admin-initiated link expires in 30 minutes');
    assert.ok(options.text.includes('Super Admin'));
  });

  // 3. Security Notification Mail Options Builder
  await runTest('buildPasswordChangeNotificationMailOptions: generates security alert with Dhaka timestamp and IP', () => {
    const to = 'owner@example.com';
    const dhakaTime = '29 Oct 2026, 03:30 PM (BST)';
    const ipAddress = '103.145.12.8';
    const options = emailModule.buildPasswordChangeNotificationMailOptions(to, { dhakaTime, ipAddress });

    assert.strictEqual(options.to, to);
    assert.strictEqual(options.subject, 'Security Alert: Your BFI Classroom Password Has Been Changed');
    assert.ok(options.html.includes(dhakaTime));
    assert.ok(options.html.includes(ipAddress));
    assert.ok(options.text.includes(dhakaTime));
    assert.ok(options.text.includes(ipAddress));
  });

  // 4. Email Verification Mail Options Builder
  await runTest('buildEmailVerificationMailOptions: generates verification challenge options', () => {
    const to = 'verify@example.com';
    const link = 'https://bfibd.org/bfi-classroom/verify-email?token=verif123';
    const options = emailModule.buildEmailVerificationMailOptions(to, link);

    assert.strictEqual(options.to, to);
    assert.strictEqual(options.subject, 'Verify Your Email Address - BFI Classroom');
    assert.ok(options.html.includes(link));
    assert.ok(options.html.includes('24 hours'));
  });

  // 5. Local JSON Transport Dispatch & Structure Validation
  await runTest('Nodemailer 10 JSON transport: dispatches and parses mail options into normalized structure', async () => {
    const jsonTransporter = nodemailer.createTransport({ jsonTransport: true });
    const mailOptions = emailModule.buildPasswordResetMailOptions('user@example.com', 'https://example.com/reset');

    const info = await jsonTransporter.sendMail(mailOptions);
    assert.ok(info.messageId, 'Must produce a valid messageId');

    const parsed = JSON.parse(info.message);
    assert.strictEqual(parsed.to[0].address, 'user@example.com');
    assert.strictEqual(parsed.subject, 'Password Reset Request - BFI Classroom');
    assert.ok(parsed.html.includes('https://example.com/reset'));
  });

  // 6. Local Stream Transport & MIME Compliance
  await runTest('Nodemailer 10 stream transport: renders standards-compliant multipart MIME stream', async () => {
    const streamTransporter = nodemailer.createTransport({ streamTransport: true });
    const mailOptions = emailModule.buildPasswordResetMailOptions('recipient@example.com', 'https://example.com/reset');

    const info = await streamTransporter.sendMail(mailOptions);
    const mimeChunks = [];
    for await (const chunk of info.message) {
      mimeChunks.push(chunk);
    }
    const mimeOutput = Buffer.concat(mimeChunks).toString('utf8');

    assert.ok(mimeOutput.includes('MIME-Version: 1.0'));
    assert.ok(mimeOutput.includes('Subject: Password Reset Request - BFI Classroom'));
    assert.ok(mimeOutput.includes('To: recipient@example.com'));
    assert.ok(mimeOutput.includes('Content-Type: multipart/alternative'));
  });

  // 7. CRLF Header Injection Defense in Recipient & Subject
  await runTest('Nodemailer 10 CRLF defense: strips or rejects header injection attempts in recipient field', async () => {
    const streamTransporter = nodemailer.createTransport({ streamTransport: true });
    const injectedRecipient = 'user@example.com\r\nBcc: evil@attacker.com\r\nX-Injected: true';
    const mailOptions = {
      from: '"Test" <sender@example.com>',
      to: injectedRecipient,
      subject: 'Test Subject\r\nX-Injected-Subject: true',
      text: 'Test Body'
    };

    const info = await streamTransporter.sendMail(mailOptions);
    const mimeChunks = [];
    for await (const chunk of info.message) {
      mimeChunks.push(chunk);
    }
    const raw = Buffer.concat(mimeChunks).toString('utf8');

    // Headers must not contain raw unquoted CRLF before the header delimiter
    const headerSection = raw.split('\r\n\r\n')[0];
    const lines = headerSection.split('\r\n');
    for (const line of lines) {
      assert.ok(!line.startsWith('Bcc: evil@attacker.com'), 'Injected Bcc header must NOT appear as separate header');
      assert.ok(!line.startsWith('X-Injected-Subject: true'), 'Injected Subject header must NOT appear as separate header');
    }
  });

  // 8. In-Process Mock SMTP Server Loopback Negotiation
  await runTest('Nodemailer 10 SMTP client: negotiates full SMTP conversation over local mock server', async () => {
    let receivedData = '';

    // Create minimal RFC 5321 mock SMTP server on 127.0.0.1
    const mockSmtpServer = net.createServer(socket => {
      socket.write('220 localhost ESMTP MockServer\r\n');
      let inData = false;

      socket.on('data', chunk => {
        const text = chunk.toString('utf8');
        if (inData) {
          receivedData += text;
          if (receivedData.includes('\r\n.\r\n')) {
            inData = false;
            socket.write('250 2.0.0 OK: message queued 12345\r\n');
          }
          return;
        }

        const command = text.trim().toUpperCase();
        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          socket.write('250-localhost\r\n250-8BITMIME\r\n250 OK\r\n');
        } else if (command.startsWith('MAIL FROM:')) {
          socket.write('250 2.1.0 Sender OK\r\n');
        } else if (command.startsWith('RCPT TO:')) {
          socket.write('250 2.1.5 Recipient OK\r\n');
        } else if (command.startsWith('DATA')) {
          inData = true;
          socket.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
        } else if (command.startsWith('QUIT')) {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      });
    });

    await new Promise(r => mockSmtpServer.listen(0, '127.0.0.1', r));
    const port = mockSmtpServer.address().port;

    try {
      const localTransporter = nodemailer.createTransport({
        host: '127.0.0.1',
        port: port,
        secure: false,
        ignoreTLS: true
      });

      const sendResult = await localTransporter.sendMail({
        from: '"BFI Test" <test@bfibd.org>',
        to: 'target@example.com',
        subject: 'Loopback SMTP Test',
        text: 'Zero network emails sent.'
      });

      assert.ok(sendResult.response.includes('250 2.0.0 OK'));
      assert.ok(receivedData.includes('Subject: Loopback SMTP Test'));
      assert.ok(receivedData.includes('Zero network emails sent.'));
    } finally {
      mockSmtpServer.close();
    }
  });

  // 9. Unconfigured Transporter Safe Fallback
  await runTest('getTransporter: returns null safely when credentials unconfigured without crashing', () => {
    const savedUser = process.env.EMAIL_USER;
    const savedPass = process.env.EMAIL_PASS;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;

    try {
      const transporter = emailModule.getTransporter();
      assert.strictEqual(transporter, null, 'Must return null safely when credentials absent');
    } finally {
      if (savedUser) process.env.EMAIL_USER = savedUser;
      if (savedPass) process.env.EMAIL_PASS = savedPass;
    }
  });

  console.log(`\n================================================================`);
  console.log(`Nodemailer Transport Results: ${passedTests}/${totalTests} Passed`);
  console.log(`================================================================`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Nodemailer test error:', err);
    process.exit(1);
  });
}
