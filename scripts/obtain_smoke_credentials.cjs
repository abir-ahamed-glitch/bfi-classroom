#!/usr/bin/env node
/**
 * scripts/obtain_smoke_credentials.cjs
 *
 * Bounded Credential Handoff Module & Utility for BFI Classroom.
 *
 * Implements interactive secret entry, legitimate normal application login
 * (POST /api/auth/login and POST /api/auth/mfa-verify), identity and role verification
 * (GET /api/auth/me), and protected temporary token file storage (0o600 / 0o700).
 *
 * Security & Lifecycle Guarantees:
 * 1. Zero Secret Echo: Terminal input uses raw mode with zero echoing (no characters, no asterisks).
 * 2. Zero Secret Leaks: Passwords, MFA codes, and JWT access tokens are never printed to stdout, stderr, logs, or chat.
 * 3. Legitimate Auth: Obtains tokens exclusively through normal backend endpoints; no synthetic signing or direct DB session manipulation.
 * 4. Identity & Role Verification: Verifies both Super Admin (ID 1, role: admin, is_super_admin: 1) and Ordinary Admin (ID 7, role: admin, is_super_admin: 0).
 * 5. Protected Temporary Storage: Stores tokens in uniquely named temporary files with mode 0o600 inside a directory with mode 0o700.
 * 6. Best-Effort Secure Purge: Registers cleanup handlers on exit, SIGINT, SIGTERM, and unhandled exceptions to zero-fill and unlink all token files.
 *    (Note: Complete memory erasure cannot be guaranteed in garbage-collected JavaScript runtimes, nor can user-space handlers execute after uncatchable terminations such as SIGKILL or power loss).
 * 7. Fail-Closed Recovery: Any timeout, cancellation, or auth failure throws an error to halt the lifecycle and trigger pre-exposure rollback.
 * 8. Complete Listener Cleanup: Ensures timeout, cancellation, EOF, success, and errors detach all listeners, close readline interfaces, clear timers, and restore terminal raw mode so subsequent input cannot reach expired prompts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const readline = require('readline');

// Low-level HTTP JSON request helper
function sendJsonRequest(urlStr, options = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (err) {
      return reject(new Error(`Invalid URL '${urlStr}': ${err.message}`));
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const bodyStr = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;

    const headers = {
      ...(options.headers || {})
    };

    if (bodyStr) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const reqOptions = {
      method: options.method || 'GET',
      headers,
      timeout: timeoutMs
    };

    const req = transport.request(parsedUrl, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          if (data && data.trim()) json = JSON.parse(data);
        } catch {
          // Non-JSON response
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms for ${parsedUrl.pathname}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// Interactive secret prompt with zero echo and complete listener cleanup
function promptSecret(promptText, options = {}) {
  const timeoutMs = options.timeoutMs || 60000;
  const input = options.input || process.stdin;
  const output = options.output || process.stderr;

  return new Promise((resolve, reject) => {
    let timeoutTimer = null;
    let isCleanedUp = false;
    let onData = null;
    let onError = null;
    let rl = null;
    let priorRawMode = false;

    if (input.isTTY && typeof input.isRaw === 'boolean') {
      priorRawMode = input.isRaw;
    }

    function cleanup() {
      if (isCleanedUp) return;
      isCleanedUp = true;

      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      if (onData && typeof input.removeListener === 'function') {
        input.removeListener('data', onData);
        onData = null;
      }

      if (onError && typeof input.removeListener === 'function') {
        input.removeListener('error', onError);
        onError = null;
      }

      if (rl) {
        try {
          rl.removeAllListeners();
          rl.close();
        } catch { /* ignore */ }
        rl = null;
      }

      if (input.isTTY && typeof input.setRawMode === 'function') {
        try { input.setRawMode(priorRawMode); } catch { /* ignore */ }
        try { input.pause(); } catch { /* ignore */ }
      }
    }

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        cleanup();
        output.write('\n');
        reject(new Error(`Credential entry timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }

    output.write(promptText);

    if (input.isTTY && typeof input.setRawMode === 'function') {
      try {
        input.setRawMode(true);
      } catch (err) {
        cleanup();
        return reject(new Error(`Failed to initialize raw terminal mode: ${err.message}`));
      }
      input.resume();

      let secretBuffer = '';

      onData = (chunk) => {
        if (isCleanedUp) return; // Guard against late invocation
        const str = chunk.toString('utf8');
        for (let i = 0; i < str.length; i++) {
          const char = str[i];
          const code = char.charCodeAt(0);

          // Ctrl+C (ETX = 3)
          if (code === 3) {
            cleanup();
            output.write('\n');
            return reject(new Error('Credential entry cancelled by operator (Ctrl+C).'));
          }

          // Ctrl+D (EOT = 4)
          if (code === 4) {
            cleanup();
            output.write('\n');
            if (secretBuffer.length === 0) {
              return reject(new Error('Credential entry received EOF (Ctrl+D).'));
            }
            return resolve(secretBuffer);
          }

          // Enter (\r or \n)
          if (code === 13 || code === 10) {
            cleanup();
            output.write('\n');
            return resolve(secretBuffer);
          }

          // Backspace (\b = 8, DEL = 127)
          if (code === 8 || code === 127) {
            if (secretBuffer.length > 0) {
              secretBuffer = secretBuffer.slice(0, -1);
            }
            continue;
          }

          // Normal character: append without writing to output
          secretBuffer += char;
        }
      };

      onError = (err) => {
        cleanup();
        output.write('\n');
        reject(new Error(`Terminal input error: ${err.message}`));
      };

      input.on('data', onData);
      input.on('error', onError);
    } else {
      // Non-interactive / piped fallback
      rl = readline.createInterface({
        input,
        output: null,
        terminal: false
      });

      rl.once('line', (line) => {
        cleanup();
        output.write('\n');
        resolve(line.trim());
      });

      rl.once('close', () => {
        cleanup();
        output.write('\n');
        reject(new Error('Input stream closed without credential.'));
      });

      onError = (err) => {
        cleanup();
        output.write('\n');
        reject(new Error(`Input stream error: ${err.message}`));
      };
      input.on('error', onError);
    }
  });
}

// Normal application login with MFA and maintenance/Turnstile support
async function loginUser({ baseUrl, username, password, mfaCode, mfaRecoveryCode, turnstileToken, maintenanceAuthToken, prompter, timeoutMs = 15000 }) {
  const loginUrl = `${baseUrl.replace(/\/+$/, '')}/api/auth/login`;

  const headers = {};
  if (maintenanceAuthToken) {
    headers['x-bfi-maintenance-token'] = maintenanceAuthToken;
  }

  const reqBody = {
    username,
    password,
    type: 'admin'
  };

  if (turnstileToken) {
    reqBody.turnstileToken = turnstileToken;
  }

  const loginRes = await sendJsonRequest(loginUrl, {
    method: 'POST',
    headers,
    body: reqBody
  }, timeoutMs);

  if (loginRes.status !== 200) {
    const errMsg = (loginRes.json && loginRes.json.error) ? loginRes.json.error : `HTTP ${loginRes.status}: ${loginRes.body}`;
    throw new Error(`Login failed for '${username}': ${errMsg}`);
  }

  const loginData = loginRes.json;
  if (!loginData || typeof loginData !== 'object') {
    throw new Error(`Login returned invalid JSON response for '${username}'`);
  }

  // Handle MFA Challenge
  if (loginData.requireMfa === true) {
    const mfaToken = loginData.mfaToken;
    if (!mfaToken) {
      throw new Error(`MFA challenge returned without mfaToken for '${username}'`);
    }

    let code = mfaCode;
    let recoveryCode = mfaRecoveryCode;

    if (!code && !recoveryCode) {
      if (typeof prompter === 'function') {
        const enteredCode = await prompter({
          role: 'mfa',
          username,
          promptText: `Enter 6-digit TOTP MFA code (or recovery code) for ${username}: `
        });
        if (enteredCode && enteredCode.length > 6) {
          recoveryCode = enteredCode;
        } else {
          code = enteredCode;
        }
      } else {
        throw new Error(`MFA code required for '${username}' but no prompter or code provided.`);
      }
    }

    const mfaVerifyUrl = `${baseUrl.replace(/\/+$/, '')}/api/auth/mfa-verify`;
    const mfaBody = { mfaToken };
    if (recoveryCode) {
      mfaBody.recoveryCode = recoveryCode;
    } else {
      mfaBody.code = code;
    }

    const mfaRes = await sendJsonRequest(mfaVerifyUrl, {
      method: 'POST',
      body: mfaBody
    }, timeoutMs);

    if (mfaRes.status !== 200) {
      const errMsg = (mfaRes.json && mfaRes.json.error) ? mfaRes.json.error : `HTTP ${mfaRes.status}: ${mfaRes.body}`;
      throw new Error(`MFA verification failed for '${username}': ${errMsg}`);
    }

    const mfaData = mfaRes.json;
    if (!mfaData || !mfaData.token) {
      throw new Error(`MFA verification did not return access token for '${username}'`);
    }

    return { token: mfaData.token, user: mfaData.user };
  }

  // Direct login without MFA
  if (!loginData.token) {
    throw new Error(`Login succeeded but did not return access token for '${username}'`);
  }

  return { token: loginData.token, user: loginData.user };
}

// Profile and role verification via GET /api/auth/me
async function verifyAdminIdentity({ baseUrl, token, expectedId, expectedRole = 'admin', expectedSuperAdmin = null, timeoutMs = 10000 }) {
  const meUrl = `${baseUrl.replace(/\/+$/, '')}/api/auth/me`;

  const res = await sendJsonRequest(meUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  }, timeoutMs);

  if (res.status !== 200) {
    throw new Error(`Identity check GET /api/auth/me returned HTTP ${res.status} (expected 200)`);
  }

  const user = res.json;
  if (!user || typeof user !== 'object') {
    throw new Error('Identity check GET /api/auth/me returned invalid JSON');
  }

  if (user.role !== expectedRole) {
    throw new Error(`Identity role mismatch: expected role '${expectedRole}', received '${user.role}'`);
  }

  if (expectedId !== undefined && expectedId !== null) {
    if (Number(user.id) !== Number(expectedId)) {
      throw new Error(`Identity user ID mismatch: expected ID ${expectedId}, received ID ${user.id}`);
    }
  }

  const isSuper = user.is_super_admin === 1 || user.isSuperAdmin === true;
  if (expectedSuperAdmin === true && !isSuper) {
    throw new Error(`Super Admin identity verification failed: user ID ${user.id} does not have is_super_admin: 1`);
  }
  if (expectedSuperAdmin === false && isSuper) {
    throw new Error(`Ordinary Admin identity verification failed: user ID ${user.id} unexpectedly has is_super_admin: 1`);
  }

  return user;
}

// Protected temporary token file storage with best-effort zero-fill cleanup
function createProtectedTokenStorage({ superAdminToken, adminToken, customDir = null }) {
  const baseDir = customDir || path.join(os.tmpdir(), `bfi_auth_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);

  try {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(baseDir, 0o700); } catch { /* ignore on Windows */ }
  } catch (err) {
    throw new Error(`Failed to create protected credential directory '${baseDir}': ${err.message}`);
  }

  const saNonce = crypto.randomBytes(8).toString('hex');
  const oaNonce = crypto.randomBytes(8).toString('hex');

  const superAdminTokenFile = path.join(baseDir, `sa_${saNonce}.token`);
  const adminTokenFile = path.join(baseDir, `oa_${oaNonce}.token`);

  // Write files with mode 0o600
  fs.writeFileSync(superAdminTokenFile, superAdminToken, { mode: 0o600 });
  try { fs.chmodSync(superAdminTokenFile, 0o600); } catch { /* ignore on Windows */ }

  fs.writeFileSync(adminTokenFile, adminToken, { mode: 0o600 });
  try { fs.chmodSync(adminTokenFile, 0o600); } catch { /* ignore on Windows */ }

  let cleanedUp = false;

  // Best-effort zero-out and unlink handler
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;

    try {
      if (fs.existsSync(superAdminTokenFile)) {
        const len = fs.statSync(superAdminTokenFile).size;
        fs.writeFileSync(superAdminTokenFile, Buffer.alloc(len, 0));
        fs.unlinkSync(superAdminTokenFile);
      }
    } catch { /* best effort */ }

    try {
      if (fs.existsSync(adminTokenFile)) {
        const len = fs.statSync(adminTokenFile).size;
        fs.writeFileSync(adminTokenFile, Buffer.alloc(len, 0));
        fs.unlinkSync(adminTokenFile);
      }
    } catch { /* best effort */ }

    try {
      if (fs.existsSync(baseDir)) {
        fs.rmdirSync(baseDir);
      }
    } catch { /* best effort */ }
  }

  // Register process exit and interrupt hooks
  const exitHandler = () => cleanup();
  process.once('exit', exitHandler);
  process.once('SIGINT', exitHandler);
  process.once('SIGTERM', exitHandler);
  process.once('uncaughtException', exitHandler);
  process.once('unhandledRejection', exitHandler);

  return {
    baseDir,
    superAdminTokenFile,
    adminTokenFile,
    cleanup: () => {
      cleanup();
      process.removeListener('exit', exitHandler);
      process.removeListener('SIGINT', exitHandler);
      process.removeListener('SIGTERM', exitHandler);
      process.removeListener('uncaughtException', exitHandler);
      process.removeListener('unhandledRejection', exitHandler);
    }
  };
}

// Master coordinator: Bounded credential handoff
async function obtainSmokeCredentials(options = {}) {
  const baseUrl = options.baseUrl || 'http://127.0.0.1:3001';
  const superAdminUsername = options.superAdminUsername || 'admin@abir';
  const ordinaryAdminUsername = options.ordinaryAdminUsername || 'admin2';
  const timeoutMs = options.timeoutMs || 60000;
  const credentialProvider = options.credentialProvider || null;
  const maintenanceAuthToken = options.maintenanceAuthToken || null;
  const turnstileToken = options.turnstileToken || null;

  async function getSecret({ role, username, isMfa, promptText }) {
    if (typeof credentialProvider === 'function') {
      return await credentialProvider({ role, username, isMfa });
    }
    return await promptSecret(promptText, { timeoutMs });
  }

  let storage = null;

  try {
    console.log('\n================================================================');
    console.log('BOUNDED SMOKE CREDENTIAL HANDOFF (CONFIDENTIAL INTERACTIVE INPUT)');
    console.log('================================================================');
    console.log(`Backend Base URL: ${baseUrl}`);
    console.log('Zero Echo: Passwords, MFA codes, and JWTs are not displayed or logged.\n');

    // 1. Super Admin Authentication (ID 1)
    console.log(`[1/4] Authenticating Super Admin (${superAdminUsername})...`);
    let saPassword = options.superAdminPassword;
    if (!saPassword) {
      saPassword = await getSecret({
        role: 'super_admin',
        username: superAdminUsername,
        isMfa: false,
        promptText: `Enter password for Super Admin (${superAdminUsername}): `
      });
    }

    const saAuth = await loginUser({
      baseUrl,
      username: superAdminUsername,
      password: saPassword,
      mfaCode: options.superAdminMfaCode,
      mfaRecoveryCode: options.superAdminMfaRecoveryCode,
      turnstileToken,
      maintenanceAuthToken,
      prompter: async ({ username, promptText }) => {
        return await getSecret({
          role: 'super_admin_mfa',
          username,
          isMfa: true,
          promptText
        });
      },
      timeoutMs: 15000
    });

    // 2. Super Admin Identity & Role Verification
    console.log('[2/4] Verifying Super Admin identity and privilege level...');
    const saProfile = await verifyAdminIdentity({
      baseUrl,
      token: saAuth.token,
      expectedId: 1,
      expectedRole: 'admin',
      expectedSuperAdmin: true,
      timeoutMs: 10000
    });
    console.log(`      Verified: User ID ${saProfile.id} (${saProfile.username}) has Super Admin privileges.`);

    // 3. Ordinary Admin Authentication (ID 7)
    console.log(`\n[3/4] Authenticating Ordinary Admin (${ordinaryAdminUsername})...`);
    let oaPassword = options.ordinaryAdminPassword;
    if (!oaPassword) {
      oaPassword = await getSecret({
        role: 'ordinary_admin',
        username: ordinaryAdminUsername,
        isMfa: false,
        promptText: `Enter password for Ordinary Admin (${ordinaryAdminUsername}): `
      });
    }

    const oaAuth = await loginUser({
      baseUrl,
      username: ordinaryAdminUsername,
      password: oaPassword,
      mfaCode: options.ordinaryAdminMfaCode,
      mfaRecoveryCode: options.ordinaryAdminMfaRecoveryCode,
      turnstileToken,
      maintenanceAuthToken,
      prompter: async ({ username, promptText }) => {
        return await getSecret({
          role: 'ordinary_admin_mfa',
          username,
          isMfa: true,
          promptText
        });
      },
      timeoutMs: 15000
    });

    // 4. Ordinary Admin Identity & Role Verification
    console.log('[4/4] Verifying Ordinary Admin identity and privilege level...');
    const oaProfile = await verifyAdminIdentity({
      baseUrl,
      token: oaAuth.token,
      expectedId: 7,
      expectedRole: 'admin',
      expectedSuperAdmin: false,
      timeoutMs: 10000
    });
    console.log(`      Verified: User ID ${oaProfile.id} (${oaProfile.username}) has Ordinary Admin privileges.`);

    // 5. Store in protected temporary token files
    storage = createProtectedTokenStorage({
      superAdminToken: saAuth.token,
      adminToken: oaAuth.token,
      customDir: options.tokenDir || null
    });

    console.log('\n✅ Bounded credential handoff complete: Both identities and roles verified.');
    console.log('   Protected temporary token files created with mode 0o600 in 0o700 directory.');

    return {
      superAdminToken: saAuth.token,
      adminToken: oaAuth.token,
      superAdminTokenFile: storage.superAdminTokenFile,
      adminTokenFile: storage.adminTokenFile,
      cleanup: storage.cleanup
    };
  } catch (err) {
    if (storage) {
      storage.cleanup();
    }
    console.error(`\n❌ [CREDENTIAL HANDOFF HALTED] ${err.message}`);
    throw err;
  }
}

// Standalone CLI execution
if (require.main === module) {
  const baseUrlArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:3001';
  const outputFiles = process.argv.includes('--output-files');

  obtainSmokeCredentials({ baseUrl: baseUrlArg }).then((res) => {
    if (outputFiles) {
      console.log(`SUPER_ADMIN_TOKEN_FILE=${res.superAdminTokenFile}`);
      console.log(`ADMIN_TOKEN_FILE=${res.adminTokenFile}`);
    } else {
      console.log('Tokens successfully obtained in memory and verified. Exiting test.');
      res.cleanup();
    }
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

module.exports = {
  obtainSmokeCredentials,
  promptSecret,
  loginUser,
  verifyAdminIdentity,
  createProtectedTokenStorage,
  sendJsonRequest
};
