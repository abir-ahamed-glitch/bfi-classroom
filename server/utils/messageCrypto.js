import crypto from 'crypto';

const ENCRYPTION_PREFIX = 'enc:v1';

let cachedKey = null;

function getMessageEncryptionKey() {
  if (cachedKey) return cachedKey;

  const rawKey = process.env.MESSAGE_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error('MESSAGE_ENCRYPTION_KEY is required for encrypted messaging.');
  }

  const candidates = [
    Buffer.from(rawKey, 'base64'),
    Buffer.from(rawKey, 'hex'),
  ];

  const key = candidates.find((candidate) => candidate.length === 32) || crypto.createHash('sha256').update(rawKey).digest();
  cachedKey = key;
  return cachedKey;
}

export function isEncryptedMessageContent(value) {
  return typeof value === 'string' && value.startsWith(`${ENCRYPTION_PREFIX}:`);
}

export function encryptMessageContent(value) {
  const plainText = value == null ? '' : String(value);
  if (isEncryptedMessageContent(plainText)) return plainText;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMessageEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptMessageContent(value) {
  if (value == null) return value;
  const content = String(value);
  if (!isEncryptedMessageContent(content)) return content;

  try {
    const [, , encodedIv, encodedTag, encodedCipherText] = content.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getMessageEncryptionKey(),
      Buffer.from(encodedIv, 'base64url'),
    );

    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCipherText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    console.error('Message decrypt failed:', error);
    return '[Encrypted message unavailable]';
  }
}
