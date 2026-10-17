import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError, safeFetch, type RawLookup } from '../../src/crawler/safeFetch';
import { startSite, type SiteServer } from '../helpers/siteServer';

const UA = 'ChatPilotBot/1.0 (+test)';

describe('safeFetch', () => {
  let site: SiteServer;
  beforeAll(async () => {
    site = await startSite({
      '/': { body: '<html><body><p>Hello world</p></body></html>' },
      '/to-metadata': { redirect: 'http://169.254.169.254/latest/meta-data/' },
      '/to-localhost': { redirect: 'http://localhost/admin' },
      '/to-self': { redirect: '/' },
      '/loop': { redirect: '/loop' },
      '/image': { body: 'PNG', headers: { 'content-type': 'image/png' } },
      '/big': { body: `<html><body>${'x'.repeat(50_000)}</body></html>` },
      '/gzip': {
        body: zlib.gzipSync(Buffer.from('<html><body><p>compressed hello</p></body></html>')) as unknown as string,
        headers: { 'content-encoding': 'gzip' },
      },
    });
  });
  afterAll(() => site.close());

  const opts = () => ({ userAgent: UA, timeoutMs: 4000, allowPrivateForTests: { hosts: [site.host] } });

  it('fetches an allowed page', async () => {
    const res = await safeFetch(`${site.url}/`, opts());
    expect(res.status).toBe(200);
    expect(res.body).toContain('Hello world');
  });

  it('blocks a redirect from an allowed host to the cloud metadata IP', async () => {
    await expect(safeFetch(`${site.url}/to-metadata`, opts())).rejects.toMatchObject({ code: 'blocked' });
  });

  it('blocks a redirect to localhost', async () => {
    await expect(safeFetch(`${site.url}/to-localhost`, opts())).rejects.toBeInstanceOf(FetchError);
  });

  it('follows safe same-host redirects and caps redirect loops', async () => {
    const ok = await safeFetch(`${site.url}/to-self`, opts());
    expect(ok.body).toContain('Hello world');
    expect(ok.redirects.length).toBe(1);
    await expect(safeFetch(`${site.url}/loop`, opts())).rejects.toMatchObject({ code: 'too_many_redirects' });
  });

  it('rejects unsupported content types', async () => {
    await expect(safeFetch(`${site.url}/image`, opts())).rejects.toMatchObject({ code: 'unsupported_type' });
  });

  it('caps the response size', async () => {
    const res = await safeFetch(`${site.url}/big`, { ...opts(), maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(1000);
  });

  it('decompresses gzip', async () => {
    const res = await safeFetch(`${site.url}/gzip`, opts());
    expect(res.body).toContain('compressed hello');
  });

  it('re-validates DNS at connect time (DNS rebinding): a public-looking host resolving to 127.0.0.1 is blocked', async () => {
    const port = site.host.split(':')[1];
    const rebinding: RawLookup = (_h, _o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
    // Port 80 so syntax checks pass; the stubbed resolver returns loopback at connect time.
    await expect(safeFetch('http://rebind.example.com/', { userAgent: UA, timeoutMs: 3000, lookup: rebinding })).rejects.toMatchObject({ code: 'blocked' });
    expect(port).toBeTruthy();
  });

  it('blocks NAT64 addresses embedding private IPv4 at connect time', async () => {
    const nat64Meta: RawLookup = (_h, _o, cb) => cb(null, [{ address: '64:ff9b::a9fe:a9fe', family: 6 }]);
    await expect(safeFetch('http://nat64.example.com/', { userAgent: UA, timeoutMs: 3000, lookup: nat64Meta })).rejects.toMatchObject({ code: 'blocked' });
    const nat64Loop: RawLookup = (_h, _o, cb) => cb(null, [{ address: '64:ff9b::7f00:1', family: 6 }]);
    await expect(safeFetch('http://nat64.example.com/', { userAgent: UA, timeoutMs: 3000, lookup: nat64Loop })).rejects.toMatchObject({ code: 'blocked' });
  });

  it('blocks when any resolved address is private', async () => {
    const mixed: RawLookup = (_h, _o, cb) =>
      cb(null, [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.7', family: 4 },
      ]);
    await expect(safeFetch('http://mixed.example.com/', { userAgent: UA, timeoutMs: 3000, lookup: mixed })).rejects.toMatchObject({ code: 'blocked' });
  });
});
