import type { FrameCheckResult } from '@chatpilot/shared';
import { safeFetch, type SafeFetchOptions } from './safeFetch';
import { parseAndCheckUrl } from './urlSafety';

/**
 * Determines whether a site can be shown inside an iframe on our app origin
 * (Preview Studio live mode). Inspects X-Frame-Options and CSP frame-ancestors.
 * CSP frame-ancestors takes precedence over X-Frame-Options, as in browsers.
 */

function headerValues(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function sourceMatches(source: string, app: URL): boolean {
  const s = source.trim().replace(/\/$/, '');
  if (s === '*') return true;
  if (s === `${app.protocol}`) return true; // e.g. "https:"
  if (s === app.origin) return true;
  if (s === app.host) return true;
  const wild = /^(?:(https?):\/\/)?\*\.(.+)$/i.exec(s);
  if (wild) {
    if (wild[1] && `${wild[1]}:` !== app.protocol) return false;
    return app.hostname.endsWith(`.${wild[2].split(':')[0]}`);
  }
  return false;
}

export function evaluateFrameHeaders(
  headers: Record<string, string | string[] | undefined>,
  appOrigin: string,
): { frameable: boolean; reason?: string } {
  const app = new URL(appOrigin);
  const csp = headerValues(headers['content-security-policy']).join(',');
  const directive = csp
    .split(/[;,]/)
    .map((d) => d.trim())
    .find((d) => d.toLowerCase().startsWith('frame-ancestors'));
  if (directive) {
    const sources = directive.split(/\s+/).slice(1);
    if (sources.some((s) => sourceMatches(s, app))) return { frameable: true };
    return { frameable: false, reason: `The site's Content-Security-Policy (frame-ancestors ${sources.join(' ') || "'none'"}) blocks embedding.` };
  }
  const xfo = headerValues(headers['x-frame-options']).join(',').toLowerCase();
  if (xfo.includes('deny')) return { frameable: false, reason: 'The site sends X-Frame-Options: DENY.' };
  if (xfo.includes('sameorigin')) return { frameable: false, reason: 'The site sends X-Frame-Options: SAMEORIGIN.' };
  if (xfo.includes('allow-from')) return { frameable: false, reason: 'The site restricts embedding with X-Frame-Options.' };
  return { frameable: true };
}

export class FrameChecker {
  private cache = new Map<string, { at: number; result: FrameCheckResult }>();

  constructor(
    private readonly fetchOpts: SafeFetchOptions,
    private readonly appOrigin: string,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  async check(input: string): Promise<FrameCheckResult> {
    const parsed = parseAndCheckUrl(input, this.fetchOpts);
    const url = parsed.href;
    const key = parsed.origin + parsed.pathname;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.result;
    let result: FrameCheckResult;
    try {
      const res = await safeFetch(url, { ...this.fetchOpts, headersOnly: true, timeoutMs: Math.min(this.fetchOpts.timeoutMs ?? 8000, 8000) });
      if (res.status >= 400) {
        result = { url, frameable: false, reason: `The site returned HTTP ${res.status}.` };
      } else {
        result = { url, ...evaluateFrameHeaders(res.headers, this.appOrigin) };
      }
    } catch {
      // Never echo network/DNS details (resolved addresses etc.) to the public.
      result = { url, frameable: false, reason: 'Could not load the site.' };
    }
    this.cache.set(key, { at: Date.now(), result });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    return result;
  }
}
