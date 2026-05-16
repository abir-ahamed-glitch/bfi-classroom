export const E2E_PREFIX = 'e2e:v1:';
export const E2E_FILE_PREFIX = 'e2e-file:v1:';

function getStorageKey(userId) {
  return `e2e_keys_${userId}`;
}

export async function getOrGenerateKeyPair(userId) {
  const storageKey = getStorageKey(userId);
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const { publicKeyJwk, privateKeyJwk } = JSON.parse(stored);
      return { publicKeyJwk, privateKeyJwk };
    } catch (e) {
      console.error('Failed to parse stored keys', e);
    }
  }

  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );

  const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  localStorage.setItem(storageKey, JSON.stringify({ publicKeyJwk, privateKeyJwk }));

  return { publicKeyJwk, privateKeyJwk };
}

async function importPublicKey(jwk) {
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

async function importPrivateKey(jwk) {
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

// Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

async function encryptPayloadE2E(data, myPublicKeyJwk, theirPublicKeyJwk, prefix) {
  if (!myPublicKeyJwk) {
    throw new Error('Your secure messaging key is not ready yet. Please refresh and try again.');
  }
  if (!theirPublicKeyJwk) {
    throw new Error('This user has not logged in since secure messaging was enabled. They need to log in once before receiving encrypted messages.');
  }

  // Generate a random AES-GCM key for this message
  const aesKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the message text with the AES key
  const ciphertextBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    data
  );

  // Export the raw AES key
  const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);

  // Import RSA public keys
  const myPubKey = await importPublicKey(myPublicKeyJwk);
  const theirPubKey = await importPublicKey(theirPublicKeyJwk);

  // Encrypt the AES key for the sender and receiver
  const senderEncryptedKeyBuf = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    myPubKey,
    rawAesKey
  );

  const receiverEncryptedKeyBuf = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    theirPubKey,
    rawAesKey
  );

  const payload = {
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertextBuf),
    senderEncKey: arrayBufferToBase64(senderEncryptedKeyBuf),
    receiverEncKey: arrayBufferToBase64(receiverEncryptedKeyBuf),
  };

  return prefix + JSON.stringify(payload);
}

export async function encryptMessageE2E(text, myPublicKeyJwk, theirPublicKeyJwk) {
  const encoder = new TextEncoder();
  return encryptPayloadE2E(encoder.encode(text), myPublicKeyJwk, theirPublicKeyJwk, E2E_PREFIX);
}

async function decryptPayloadE2E(payloadStr, myPrivateKeyJwk, role, prefix) {
  if (!payloadStr.startsWith(prefix)) {
    return null;
  }

  try {
    const jsonStr = payloadStr.slice(prefix.length);
    const payload = JSON.parse(jsonStr);

    const iv = base64ToArrayBuffer(payload.iv);
    const ciphertext = base64ToArrayBuffer(payload.ciphertext);
    const encKey = base64ToArrayBuffer(role === 'sender' ? payload.senderEncKey : payload.receiverEncKey);

    const privateKey = await importPrivateKey(myPrivateKeyJwk);

    // Decrypt the AES key
    const rawAesKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      encKey
    );

    // Import the decrypted AES key
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      rawAesKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt the ciphertext
    const decryptedBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext
    );

    return decryptedBuf;
  } catch (e) {
    console.error('Failed to decrypt E2E message', e);
    return null;
  }
}

export async function decryptMessageE2E(payloadStr, myPrivateKeyJwk, role) {
  if (!payloadStr.startsWith(E2E_PREFIX)) {
    return payloadStr; // Legacy or non-E2E message
  }

  const decryptedBuf = await decryptPayloadE2E(payloadStr, myPrivateKeyJwk, role, E2E_PREFIX);
  if (!decryptedBuf) return '[Encrypted message - key unavailable]';

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuf);
}

export async function encryptFileE2E(file, myPublicKeyJwk, theirPublicKeyJwk) {
  const encryptedPayload = await encryptPayloadE2E(
    await file.arrayBuffer(),
    myPublicKeyJwk,
    theirPublicKeyJwk,
    E2E_FILE_PREFIX
  );

  const blob = new Blob([encryptedPayload], { type: 'application/octet-stream' });
  blob.name = `${file.name}.e2e`;
  blob.lastModified = Date.now();
  return blob;
}

export async function decryptFileE2E(payloadStr, myPrivateKeyJwk, role) {
  if (!payloadStr.startsWith(E2E_FILE_PREFIX)) {
    return null;
  }

  return decryptPayloadE2E(payloadStr, myPrivateKeyJwk, role, E2E_FILE_PREFIX);
}

// ── Password-based private key protection ─────────────────────────────────
// The private key JWK is encrypted with a key derived from the user's login
// password via PBKDF2-SHA256 before being uploaded to the server. The server
// stores only an opaque encrypted blob — it can NEVER decrypt it without the
// user's plain-text password (which the server never receives in plain text).
//
// Blob format:  pkenc:v1:<salt_b64>:<iv_b64>:<ciphertext_b64>

const PK_ENC_PREFIX = 'pkenc:v1';

async function deriveKeyFromPassword(password, saltBuffer) {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100_000, // OWASP-recommended minimum for PBKDF2-SHA256
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a private key JWK with the user's login password.
 * Returns a self-contained string blob safe to store on the server.
 */
export async function encryptPrivateKeyWithPassword(privateKeyJwk, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv   = window.crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveKeyFromPassword(password, salt);

  const plaintext  = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintext,
  );

  return [
    PK_ENC_PREFIX,
    arrayBufferToBase64(salt),
    arrayBufferToBase64(iv),
    arrayBufferToBase64(ciphertext),
  ].join(':');
}

/**
 * Decrypt a private key blob produced by encryptPrivateKeyWithPassword.
 * Returns the JWK object, or null if the password is wrong / blob is corrupt.
 */
export async function decryptPrivateKeyWithPassword(encryptedBlob, password) {
  if (typeof encryptedBlob !== 'string' || !encryptedBlob.startsWith(`${PK_ENC_PREFIX}:`)) {
    return null;
  }

  try {
    // parts: ['pkenc', 'v1', salt, iv, ciphertext]
    const parts      = encryptedBlob.split(':');
    const salt       = base64ToArrayBuffer(parts[2]);
    const iv         = base64ToArrayBuffer(parts[3]);
    const ciphertext = base64ToArrayBuffer(parts[4]);

    const aesKey    = await deriveKeyFromPassword(password, salt);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext,
    );

    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    // Wrong password or corrupted blob
    return null;
  }
}

