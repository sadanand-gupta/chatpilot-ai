import dns from 'node:dns';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import zlib from 'node:zlib';
import { isAllowedForTests, isPublicAddress, parseAndCheckUrl, type UrlSafetyOptions } from './urlSafety';

/**
 * SSRF-safe HTTP client for the crawler.
 * - The socket's DNS lookup is replaced by one that rejects non-public answers, so
 *   the address validated is exactly the address connected to (no DNS rebinding).
 * - Redirects are followed manually (max 5) and every hop is re-validated.
 * - Connect + total timeouts, a byte cap (also on decompressed output) and a
 *   content-type allowlist.
 */

export type FetchErrorCode = 'blocked' | 'timeout' | 'too_many_redirects' | 'unsupported_type' | 'network' | 'aborted';

export class FetchError extends Error {
  constructor(
    public readonly code: FetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export const DEFAULT_ACCEPTED_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'application/xml', 'text/xml'];

/** dns.lookup-compatible function (tests can stub it). */
export type RawLookup = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

export interface SafeFetchOptions extends UrlSafetyOptions {
  userAgent: string;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  acceptTypes?: string[];
  /** Resolve once headers arrive and discard the body (frame checks). */
  headersOnly?: boolean;
  signal?: AbortSignal;
  /** Test hook to stub DNS. Defaults to dns.lookup. */
  lookup?: RawLookup;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  contentType: string;
  body: string;
  truncated: boolean;
  redirects: string[];
}

export function makeSafeLookup(url: URL, opts: SafeFetchOptions): LookupFunction {
  const base: RawLookup = opts.lookup ?? ((h, o, cb) => dns.lookup(h, o, cb));
  const allowed = isAllowedForTests(url, opts);
  return ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    base(hostname, { all: true, family: (options?.family as number) || 0, verbatim: true } as dns.LookupAllOptions, (err, addresses) => {
      if (err) return callback(err);
      const list = Array.isArray(addresses) ? addresses : [];
      if (!list.length) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
      if (!allowed) {
        const bad = list.find((a) => !isPublicAddress(a.address));
        if (bad) return callback(new FetchError('blocked', `Blocked connection to non-public address for ${hostname}`));
      }
      if (options?.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  }) as unknown as LookupFunction;
}

function charsetFrom(contentType: string, head: Buffer): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType);
  if (m) return m[1].toLowerCase();
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head.subarray(0, 2048).toString('latin1'));
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

function decode(buf: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function requestOnce(url: URL, opts: SafeFetchOptions, deadline: number): Promise<{ res: IncomingMessage; destroy: () => void }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const req = mod.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: makeSafeLookup(url, opts),
        headers: {
          'user-agent': opts.userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'en;q=0.9,*;q=0.5',
        },
      },
      (res) => {
        if (settled) {
          res.destroy();
          return;
        }
        settled = true;
        clearTimeout(connectTimer);
        resolve({ res, destroy: () => req.destroy() });
      },
    );
    const remaining = Math.max(1, deadline - Date.now());
    const totalTimer = setTimeout(() => {
      fail(new FetchError('timeout', 'Request timed out'));
      req.destroy();
    }, remaining);
    totalTimer.unref?.();
    const connectTimer = setTimeout(() => {
      fail(new FetchError('timeout', 'Connection timed out'));
      req.destroy();
    }, Math.min(opts.connectTimeoutMs ?? 6000, remaining));
    connectTimer.unref?.();
    req.on('socket', (s) => {
      s.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () => clearTimeout(connectTimer));
    });
    req.on('close', () => clearTimeout(totalTimer));
    req.on('error', (e) => {
      clearTimeout(connectTimer);
      if (e instanceof FetchError) return fail(e);
      const code = (e as NodeJS.ErrnoException).code;
      fail(new FetchError('network', code ? `Network error (${code})` : `Network error: ${e.message}`));
    });
    if (opts.signal) {
      if (opts.signal.aborted) {
        fail(new FetchError('aborted', 'Aborted'));
        req.destroy();
        return;
      }
      opts.signal.addEventListener('abort', () => {
        fail(new FetchError('aborted', 'Aborted'));
        req.destroy();
      }, { once: true });
    }
    req.end();
  });
}

function readBody(res: IncomingMessage, maxBytes: number, deadline: number): Promise<{ buf: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const enc = String(res.headers['content-encoding'] ?? '').toLowerCase().trim();
    let stream: NodeJS.ReadableStream = res;
    if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
    else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
    else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const timer = setTimeout(() => finish(true), Math.max(1, deadline - Date.now()));
    timer.unref?.();
    const finish = (truncated: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (truncated) {
        if (stream !== res) (stream as unknown as { destroy(): void }).destroy();
        res.destroy();
      }
      resolve({ buf: Buffer.concat(chunks), truncated });
    };
    stream.on('data', (c: Buffer) => {
      if (done) return;
      const room = maxBytes - size;
      if (c.length >= room) {
        chunks.push(c.subarray(0, room));
        size = maxBytes;
        finish(true);
        return;
      }
      chunks.push(c);
      size += c.length;
    });
    stream.on('end', () => finish(false));
    stream.on('error', (e: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Partial gzip output is still useful; only fail if nothing was read.
      if (chunks.length) resolve({ buf: Buffer.concat(chunks), truncated: true });
      else reject(new FetchError('network', `Could not decode response: ${e.message}`));
    });
    res.on('aborted', () => finish(true));
  });
}

export async function safeFetch(input: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 12_000);
  const accept = opts.acceptTypes ?? DEFAULT_ACCEPTED_TYPES;
  const redirects: string[] = [];
  let url = parseAndCheckUrl(input, opts);

  for (let hop = 0; ; hop++) {
    const { res } = await requestOnce(url, opts, deadline);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      res.destroy();
      if (hop >= maxRedirects) throw new FetchError('too_many_redirects', 'Too many redirects');
      let next: URL;
      try {
        next = new URL(res.headers.location, url);
      } catch {
        throw new FetchError('network', 'Invalid redirect location');
      }
      try {
        url = parseAndCheckUrl(next.href, opts);
      } catch (e) {
        throw new FetchError('blocked', `Redirect blocked: ${(e as Error).message}`);
      }
      redirects.push(url.href);
      continue;
    }
    const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
    const base = { url: url.href, status, headers: res.headers, contentType, redirects };
    if (opts.headersOnly || status < 200 || status >= 300) {
      res.destroy();
      return { ...base, body: '', truncated: false };
    }
    const mime = contentType.split(';')[0].trim();
    if (mime && !accept.includes(mime)) {
      res.destroy();
      throw new FetchError('unsupported_type', `Unsupported content type ${mime}`);
    }
    const { buf, truncated } = await readBody(res, maxBytes, deadline);
    return { ...base, body: decode(buf, charsetFrom(contentType, buf)), truncated };
  }
}
