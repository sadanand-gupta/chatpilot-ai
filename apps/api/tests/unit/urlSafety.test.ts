import { describe, expect, it } from 'vitest';
import { isPublicAddress, normalizeInputUrl, parseAndCheckUrl, validatePublicUrl } from '../../src/crawler/urlSafety';

const lookup = (addrs: string[]) => async () => addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('urlSafety', () => {
  it('adds https:// to bare domains', () => {
    expect(normalizeInputUrl('example.com')).toBe('https://example.com');
    expect(normalizeInputUrl('  http://example.com/x ')).toBe('http://example.com/x');
    expect(parseAndCheckUrl('example.com/about#team').href).toBe('https://example.com/about');
  });

  it.each([
    'http://localhost',
    'http://localhost:3000',
    'http://app.localhost',
    'http://printer.local',
    'http://db.internal',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://intranet',
    'http://127.0.0.1',
    'http://10.0.0.5',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://user:pass@example.com/',
    'file:///etc/passwd',
    'ftp://example.com/',
    'gopher://example.com/',
    'http://example.com:22/',
    'https://example.com:8443/',
    'javascript:alert(1)',
  ])('rejects %s', (u) => {
    expect(() => parseAndCheckUrl(u)).toThrow();
  });

  it('accepts public URLs on standard ports', () => {
    expect(parseAndCheckUrl('https://example.com').hostname).toBe('example.com');
    expect(parseAndCheckUrl('http://www.example.co.in:80/path?q=1').pathname).toBe('/path');
    expect(parseAndCheckUrl('https://shop.example.com:443/').hostname).toBe('shop.example.com');
  });

  it('classifies IP ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '198.18.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it('rejects hostnames that resolve to any private address', async () => {
    await expect(validatePublicUrl('https://evil.example.com', undefined, lookup(['93.184.216.34', '10.0.0.1']))).rejects.toThrow(/private/);
    await expect(validatePublicUrl('https://rebind.example.com', undefined, lookup(['169.254.169.254']))).rejects.toThrow();
    await expect(validatePublicUrl('https://v6.example.com', undefined, lookup(['::ffff:127.0.0.1']))).rejects.toThrow();
    await expect(validatePublicUrl('https://good.example.com', undefined, lookup(['93.184.216.34']))).resolves.toBeInstanceOf(URL);
  });

  it('judges NAT64/DNS64 addresses (64:ff9b::/96) by their embedded IPv4', async () => {
    expect(isPublicAddress('64:ff9b::d8c6:4f43')).toBe(true); // 216.198.79.67
    expect(isPublicAddress('64:ff9b::401d:1143')).toBe(true); // 64.29.17.67
    expect(isPublicAddress('64:ff9b:1::808:808')).toBe(true); // local-use prefix, 8.8.8.8
    expect(isPublicAddress('64:ff9b::a9fe:a9fe')).toBe(false); // 169.254.169.254
    expect(isPublicAddress('64:ff9b::7f00:1')).toBe(false); // 127.0.0.1
    expect(isPublicAddress('64:ff9b::c0a8:101')).toBe(false); // 192.168.1.1
    expect(isPublicAddress('64:ff9b:1::a00:1')).toBe(false); // 10.0.0.1
    // Real-world DNS64 answer (Indian ISP): mixed NAT64 + native IPv4, all public -> allowed.
    await expect(
      validatePublicUrl('https://aurenn-ai.vercel.app', undefined, lookup(['64:ff9b::d8c6:4f43', '64:ff9b::401d:1143', '64.29.17.131', '216.198.79.131'])),
    ).resolves.toBeInstanceOf(URL);
    // A NAT64 address embedding the metadata IP alongside a public one is still blocked.
    await expect(validatePublicUrl('https://evil64.example.com', undefined, lookup(['64:ff9b::a9fe:a9fe', '93.184.216.34']))).rejects.toThrow();
  });

  it('test escape hatch only applies to exact host:port pairs', () => {
    const opts = { allowPrivateForTests: { hosts: ['127.0.0.1:4567'] } };
    expect(parseAndCheckUrl('http://127.0.0.1:4567/', opts).port).toBe('4567');
    expect(() => parseAndCheckUrl('http://127.0.0.1:4568/', opts)).toThrow();
    expect(() => parseAndCheckUrl('http://169.254.169.254/', opts)).toThrow();
  });
});
