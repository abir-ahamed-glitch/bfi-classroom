import dns from 'dns/promises';
import net from 'net';

/**
 * Checks whether an IPv4 address is in a reserved/private/internal range.
 */
export function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
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
 * Checks whether an IPv6 address is in a reserved/private/internal range.
 */
export function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();

  // IPv4-mapped IPv6 address (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateIPv4(v4Part);
    }
    // Handle hex format
    const hexParts = v4Part.split(':');
    if (hexParts.length === 2) {
      const p1 = parseInt(hexParts[0], 16);
      const p2 = parseInt(hexParts[1], 16);
      const ipv4 = `${(p1 >> 8) & 255}.${p1 & 255}.${(p2 >> 8) & 255}.${p2 & 255}`;
      return isPrivateIPv4(ipv4);
    }
  }

  // Unspecified (::)
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
  // Loopback (::1)
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // Unique local addresses (fc00::/7 -> fc00:: through fdff::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local unicast (fe80::/10 -> fe80:: through febf::)
  if (/^fe[89ab]/i.test(normalized)) return true;

  // Multicast (ff00::/8)
  if (normalized.startsWith('ff')) return true;

  // Documentation (2001:db8::/32)
  if (normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0db8:')) return true;

  return false;
}

/**
 * Validates whether an IP address (v4 or v6) is private or internal.
 */
export function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    return isPrivateIPv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isPrivateIPv6(ip);
  }
  return true; // Unknown format is treated as unsafe
}

/**
 * Validates a target URL against SSRF vulnerabilities:
 * 1. Requires valid http: or https: protocol (optionally https only).
 * 2. Rejects local hostnames (localhost, *.local, *.internal, etc.).
 * 3. Resolves DNS records and ensures ALL resolved IPs are non-private.
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

  const hostname = parsed.hostname.toLowerCase();

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
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error('Access to private/local IP addresses is forbidden');
    }
    return { safe: true, parsedUrl: parsed, resolvedIps: [hostname] };
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

  return { safe: true, parsedUrl: parsed, resolvedIps };
}
