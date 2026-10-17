import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { AppError } from '../lib/errors';

/**
 * SSRF protection for every outbound request the crawler makes.
 *
 * - Only http/https, no embedded credentials, only ports 80/443.
 * - Rejects localhost / *.localhost / *.local / *.internal / single-label hosts /
 *   metadata.google.internal and all IP-literal hosts.
 * - Every DNS answer must be a public unicast address (ipaddr.js range 'unicast'),
 *   including after unwrapping IPv4-mapped IPv6. safeFetch re-applies this check
 *   inside the socket's lookup() so the IP that was checked is the IP connected to.
 *
 * `allowPrivateForTests` is a programmatic, test-only escape hatch listing exact
 * "host:port" pairs; it can never be set from the environment.
 */

export interface UrlSafetyOptions {
  allowPrivateForTests?: { hosts: string[] };
}

export type LookupAllFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

export const defaultLookupAll: LookupAllFn = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

export class UrlBlockedError extends AppError {
  constructor(message: string) {
    super(400, 'invalid_url', message);
    this.name = 'UrlBlockedError';
  }
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet', '.corp'];
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata', 'instance-data', 'ip6-localhost', 'ip6-loopback']);

/** Adds https:// when the user typed a bare domain; trims whitespace. */
export function normalizeInputUrl(input: string): string {
  let s = input.trim();
  if (!s) return s;
  if (s.startsWith('//')) s = `https:${s}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  return s;
}

export function hostPort(url: URL): string {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return `${url.hostname.replace(/^\[|\]$/g, '')}:${port}`;
}

export function isAllowedForTests(url: URL, opts?: UrlSafetyOptions): boolean {
  const hosts = opts?.allowPrivateForTests?.hosts;
  if (!hosts?.length) return false;
  return hosts.includes(hostPort(url));
}

function stripBrackets(h: string): string {
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

export function isIpLiteral(hostname: string): boolean {
  const h = stripBrackets(hostname);
  return ipaddr.isValid(h) || /^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h) || /^[\d.]+$/.test(h);
}

const NAT64_WKP = ipaddr.IPv6.parse('64:ff9b::');
const NAT64_LOCAL = ipaddr.IPv6.parse('64:ff9b:1::');

/** True only for globally routable unicast addresses (NAT64 addresses are judged by their embedded IPv4). */
export function isPublicAddress(address: string): boolean {
  const raw = stripBrackets(address).split('%')[0];
  if (!ipaddr.isValid(raw)) return false;
  let addr = ipaddr.parse(raw);
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
    else if (v6.match(NAT64_WKP, 96) || v6.match(NAT64_LOCAL, 48)) {
      // NAT64/DNS64 (RFC 6052, common on IPv6-only mobile/ISP networks): the address is a
      // translation of the embedded IPv4 in the last 32 bits. Judge THAT address, so
      // 64:ff9b::a9fe:a9fe (169.254.169.254) or 64:ff9b::7f00:1 (127.0.0.1) stay blocked.
      const b = v6.toByteArray();
      return isPublicAddress(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
    }
  }
  if (addr.range() !== 'unicast') return false;
  if (addr.kind() === 'ipv4') {
    const v4 = addr as ipaddr.IPv4;
    // Belt and braces for ranges some ipaddr.js versions classify as unicast.
    const extra: [string, number][] = [
      ['0.0.0.0', 8],
      ['100.64.0.0', 10],
      ['169.254.0.0', 16],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['240.0.0.0', 4],
    ];
    if (extra.some(([net, bits]) => v4.match(ipaddr.IPv4.parse(net), bits))) return false;
  } else {
    const v6 = addr as ipaddr.IPv6;
    const extra: [string, number][] = [
      ['fc00::', 7],
      ['fe80::', 10],
      ['fec0::', 10],
      ['2002::', 16],
      ['2001::', 32],
      ['2001:db8::', 32],
      ['100::', 64],
      ['::', 96],
    ];
    if (extra.some(([net, bits]) => v6.match(ipaddr.IPv6.parse(net), bits))) return false;
  }
  return true;
}

/**
 * Parses and validates a URL syntactically (no DNS). Throws UrlBlockedError.
 */
export function parseAndCheckUrl(input: string, opts?: UrlSafetyOptions): URL {
  let url: URL;
  try {
    url = new URL(normalizeInputUrl(input));
  } catch {
    throw new UrlBlockedError('That does not look like a valid website address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlBlockedError('Only http and https website addresses are supported.');
  }
  if (url.username || url.password) throw new UrlBlockedError('URLs with embedded credentials are not allowed.');
  url.hash = '';
  if (isAllowedForTests(url, opts)) return url;

  if (url.port && !['80', '443'].includes(url.port)) {
    throw new UrlBlockedError('Only standard web ports (80 and 443) are allowed.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new UrlBlockedError('That does not look like a valid website address.');
  if (isIpLiteral(host)) throw new UrlBlockedError('Please use the website domain name instead of an IP address.');
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UrlBlockedError('Local or internal addresses cannot be crawled.');
  }
  if (!host.includes('.')) throw new UrlBlockedError('Please enter a full domain name such as example.com.');
  if (!/^[a-z0-9.-]+$/.test(host) || host.split('.').some((l) => !l || l.length > 63)) {
    throw new UrlBlockedError('That does not look like a valid domain name.');
  }
  if (url.href.length > 2048) throw new UrlBlockedError('URL is too long.');
  return url;
}

/** Resolves the hostname and requires every address to be public. */
export async function assertPublicHost(url: URL, opts?: UrlSafetyOptions, lookupAll: LookupAllFn = defaultLookupAll): Promise<void> {
  if (isAllowedForTests(url, opts)) return;
  let addrs: { address: string }[];
  try {
    addrs = await lookupAll(url.hostname);
  } catch {
    throw new UrlBlockedError(`We could not find the website ${url.hostname}. Please check the address.`);
  }
  if (!addrs.length) throw new UrlBlockedError(`We could not find the website ${url.hostname}.`);
  if (addrs.some((a) => !isPublicAddress(a.address))) {
    throw new UrlBlockedError('That address points to a private or reserved network and cannot be crawled.');
  }
}

/** Full check for user-supplied URLs: syntax + DNS. */
export async function validatePublicUrl(input: string, opts?: UrlSafetyOptions, lookupAll?: LookupAllFn): Promise<URL> {
  const url = parseAndCheckUrl(input, opts);
  await assertPublicHost(url, opts, lookupAll);
  return url;
}
