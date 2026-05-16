const INSECURE_DEFAULT_SECRETS = new Set([
  'bfi-classroom-super-secret-key-change-in-production-2024',
  'bfi-classroom-refresh-secret-key-change-in-production-2024',
]);

function readRequiredSecret(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required and must not be empty.`);
  }

  if (INSECURE_DEFAULT_SECRETS.has(value)) {
    throw new Error(`${name} must be replaced with a unique secret before the server can start.`);
  }

  return value;
}

export function getJwtSecret() {
  return readRequiredSecret('JWT_SECRET');
}

export function getJwtRefreshSecret() {
  return readRequiredSecret('JWT_REFRESH_SECRET');
}
