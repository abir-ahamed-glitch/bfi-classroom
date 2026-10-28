import dns from 'dns/promises';
import net from 'net';
import { Agent } from 'undici';

/**
 * Checks whether an IPv4 address is in a reserved/private/internal range.
 */
export function isPrivateIPv4(ip) {
  const parts = String(ip).trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed is considered unsafe
  }

  const [a, b, c] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private network)
  if (a === 10) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata e.g. AWS/GCP/Oracle 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private network)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.88.99.0/24 (6to4 relay anycast)
  if (a === 192 && b === 88 && c === 99) return true;
  // 192.168.0.0/16 (Private network)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (Network benchmark)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved / Future use)
  if (a >= 240) return true;

  return false;
}

/**
 * Parses any valid IPv6 address (compressed, full, bracketed, or IPv4-mapped)
 * into an array of 8 16-bit integer values (0 to 65535).
 */
export function parseIPv6Hextets(rawIp) {
  let ip = (rawIp || '').trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  // Strip zone ID if present e.g. fe80::1%eth0
  ip = ip.split('%')[0].trim();

  let hextets = [];
  if (ip.includes('::')) {
    const parts = ip.split('::');
    if (parts.length > 2) return null; // Only one '::' allowed
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];

    let v4Count = 0;
    if (right.length > 0 && right[right.length - 1].includes('.')) {
      v4Count = 2;
    } else if (left.length > 0 && left[left.length - 1].includes('.')) {
      v4Count = 2;
    }

    const missing = 8 - (left.length + right.length + (v4Count ? 1 : 0));
    if (missing < 0) return null;
    const middle = Array(missing).fill('0');
    hextets = [...left, ...middle, ...right];
  } else {
    hextets = ip.split(':');
  }

  // Handle embedded IPv4 at the end (e.g. ::ffff:127.0.0.1)
  if (hextets.length > 0 && hextets[hextets.length - 1].includes('.')) {
    const v4 = hextets.pop();
    const v4Parts = v4.split('.').map(Number);
    if (v4Parts.length !== 4 || v4Parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
    hextets.push(((v4Parts[0] << 8) | v4Parts[1]).toString(16));
    hextets.push(((v4Parts[2] << 8) | v4Parts[3]).toString(16));
  }

  if (hextets.length !== 8) return null;
  const nums = hextets.map(h => parseInt(h, 16));
  if (nums.some(n => isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

/**
 * Checks whether an IPv6 address is in a reserved/private/internal range.
 * Fully accounts for compressed, full hex, and IPv4-mapped forms (including
 * expanded representations like 0:0:0:0:0:ffff:7f00:1).
 */
export function isPrivateIPv6(ip) {
  const nums = parseIPv6Hextets(ip);
  if (!nums) return true; // Malformed is treated as unsafe

  // Unspecified (::)
  if (nums.every(n => n === 0)) return true;

  // Loopback (::1)
  if (nums.slice(0, 7).every(n => n === 0) && nums[7] === 1) return true;

  // IPv4-mapped IPv6 address: 0:0:0:0:0:ffff:w.x.y.z or ::ffff:w.x.y.z
  if (nums.slice(0, 5).every(n => n === 0) && nums[5] === 0xffff) {
    const ip4 = `${(nums[6] >> 8) & 0xff}.${nums[6] & 0xff}.${(nums[7] >> 8) & 0xff}.${nums[7] & 0xff}`;
    return isPrivateIPv4(ip4);
  }

  // Deprecated IPv4-compatible IPv6 address: ::w.x.y.z
  if (nums.slice(0, 6).every(n => n === 0) && (nums[6] !== 0 || nums[7] !== 1)) {
    const ip4 = `${(nums[6] >> 8) & 0xff}.${nums[6] & 0xff}.${(nums[7] >> 8) & 0xff}.${nums[7] & 0xff}`;
    return isPrivateIPv4(ip4);
  }

  // Unique local addresses fc00::/7 (0xfc00 through 0xfdff)
  if ((nums[0] & 0xfe00) === 0xfc00) return true;

  // Link-local unicast fe80::/10 (0xfe80 through 0xfebf)
  if ((nums[0] & 0xffc0) === 0xfe80) return true;

  // Multicast ff00::/8
  if ((nums[0] & 0xff00) === 0xff00) return true;

  // Documentation 2001:db8::/32
  if (nums[0] === 0x2001 && nums[1] === 0x0db8) return true;

  // 6to4 prefix 2002::/16
  if (nums[0] === 0x2002) {
    const ip4 = `${(nums[1] >> 8) & 0xff}.${nums[1] & 0xff}.${(nums[2] >> 8) & 0xff}.${nums[2] & 0xff}`;
    if (isPrivateIPv4(ip4)) return true;
  }

  return false;
}

/**
 * Validates whether an IP address (v4 or v6) is private or internal.
 */
export function isPrivateIP(rawIp) {
  let ip = (rawIp || '').trim();
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  if (net.isIPv4(ip)) {
    return isPrivateIPv4(ip);
  }
  if (net.isIPv6(ip) || ip.includes(':')) {
    return isPrivateIPv6(ip);
  }
  return true; // Unknown or malformed format is treated as unsafe
}

/**
 * Validates a target URL against SSRF vulnerabilities:
 * 1. Requires valid http: or https: protocol (optionally https only).
 * 2. Rejects local hostnames (localhost, *.local, *.internal, etc.).
 * 3. Resolves DNS records and ensures ALL resolved IPs are non-private.
 * 4. Returns the validated URL and a pinned IP address for connection binding.
 */
export async function validateSafePublicUrl(targetUrl, { httpsOnly = false } = {}) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('URL is required');
  }

  let parsed;
  try {
    parsed = new URL(targetUrl.trim());
  } catch {
    throw new Error('Invalid URL format');
  }

  if (httpsOnly) {
    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed');
    }
  } else {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only HTTP and HTTPS URLs are supported');
    }
  }

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // Block common local hostnames immediately
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname === '0.0.0.0'
  ) {
    throw new Error('Access to local network hostnames is forbidden');
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname) || hostname.includes(':')) {
    if (isPrivateIP(hostname)) {
      throw new Error('Access to private/local IP addresses is forbidden');
    }
    return { safe: true, parsedUrl: parsed, resolvedIps: [hostname], pinnedIp: hostname };
  }

  // Resolve hostname via DNS
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`DNS resolution failed for host: ${hostname}`);
  }

  if (!records || records.length === 0) {
    throw new Error(`No DNS records found for host: ${hostname}`);
  }

  const resolvedIps = records.map(r => r.address);
  for (const ip of resolvedIps) {
    if (isPrivateIP(ip)) {
      throw new Error(`Hostname resolved to restricted internal address: ${ip}`);
    }
  }

  // Return the first validated public IP as the pinned destination
  return { safe: true, parsedUrl: parsed, resolvedIps, pinnedIp: resolvedIps[0] };
}

/**
 * Creates an Undici Agent that pins DNS resolution to a pre-validated IP address.
 * Guarantees that DNS rebinding cannot redirect the connection to a private address.
 */
export function createPinnedAgent(pinnedIp) {
  const family = net.isIPv6(pinnedIp) ? 6 : 4;
  return new Agent({
    connect: {
      lookup: (hostname, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        const options = typeof opts === 'object' ? opts : {};
        if (options && options.all) {
          callback(null, [{ address: pinnedIp, family }]);
        } else {
          callback(null, pinnedIp, family);
        }
      }
    }
  });
}

/**
 * Custom error indicating a streaming response exceeded configured byte boundaries.
 */
export class PayloadTooLargeError extends Error {
  constructor(message = 'Payload exceeds maximum allowed size') {
    super(message);
    this.name = 'PayloadTooLargeError';
    this.status = 413;
  }
}

/**
 * Reads a ReadableStream while strictly enforcing maximum byte limits and active cancellation.
 * Ensures the underlying stream reader is properly cancelled on limit breach, abort signals, or errors.
 */
export async function readBoundedStream(bodyStream, { maxBytes = 5 * 1024 * 1024, signal, mode = 'buffer', stopPattern = null } = {}) {
  if (!bodyStream) {
    return mode === 'text' ? { text: '', bytesRead: 0 } : { chunks: [], bytesRead: 0 };
  }

  const reader = bodyStream.getReader();
  const chunks = [];
  let bytesRead = 0;
  let text = '';
  const decoder = mode === 'text' ? new TextDecoder() : null;

  try {
    while (true) {
      if (signal?.aborted) {
        const err = new Error('Stream reading aborted');
        err.name = 'AbortError';
        throw err;
      }

      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.length;

      if (bytesRead > maxBytes) {
        if (stopPattern && mode === 'text') {
          // Soft stop for preview text
          text += decoder.decode(value, { stream: false });
          await reader.cancel();
          break;
        } else {
          await reader.cancel();
          throw new PayloadTooLargeError(`Payload exceeds maximum size limit of ${maxBytes} bytes`);
        }
      }

      if (mode === 'text') {
        text += decoder.decode(value, { stream: true });
        if (stopPattern && text.includes(stopPattern)) {
          await reader.cancel();
          break;
        }
      } else {
        chunks.push(value);
      }
    }

    if (mode === 'text') {
      return { text, bytesRead };
    }
    return { chunks, bytesRead };
  } catch (err) {
    try {
      await reader.cancel();
    } catch { /* best effort */ }
    throw err;
  }
}
