import * as cheerio from 'cheerio';
import { safeFetch, type SafeFetchOptions } from './safeFetch';

const SITEMAP_TYPES = ['application/xml', 'text/xml', 'text/plain', 'application/x-xml', 'text/html'];

export interface SitemapEntry {
  url: string;
  /** <priority> (0..1) when the sitemap declares one. */
  priority?: number;
}

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[]; entries: SitemapEntry[] } {
  const $ = cheerio.load(xml, { xml: true });
  const entries: SitemapEntry[] = [];
  const sitemaps: string[] = [];
  $('sitemap > loc').each((_, el) => {
    const v = $(el).text().trim();
    if (v) sitemaps.push(v);
  });
  $('url').each((_, el) => {
    const v = $(el).children('loc').first().text().trim();
    if (!v) return;
    const p = Number.parseFloat($(el).children('priority').first().text().trim());
    entries.push(Number.isFinite(p) && p >= 0 && p <= 1 ? { url: v, priority: p } : { url: v });
  });
  if (!entries.length && !sitemaps.length && !/^\s*</.test(xml)) {
    // Plain-text sitemap: one URL per line.
    for (const line of xml.split(/\r?\n/)) if (/^https?:\/\//.test(line.trim())) entries.push({ url: line.trim() });
  }
  return { urls: entries.map((e) => e.url), sitemaps, entries };
}

/**
 * Discovers page URLs (with their sitemap <priority>) from /sitemap.xml and
 * robots.txt "Sitemap:" lines, following a sitemap index one level deep.
 * Bounded in files and URLs.
 */
export async function discoverSitemapEntries(
  origin: string,
  robotsSitemaps: string[],
  fetchOpts: SafeFetchOptions,
  opts: { maxUrls?: number; maxFiles?: number; isSameSite?: (u: string) => boolean } = {},
): Promise<SitemapEntry[]> {
  const maxUrls = opts.maxUrls ?? 300;
  const maxFiles = opts.maxFiles ?? 6;
  const candidates = [...new Set([...robotsSitemaps, `${origin}/sitemap.xml`])].filter((u) => !opts.isSameSite || opts.isSameSite(u));
  const out = new Map<string, SitemapEntry>();
  let files = 0;

  const load = async (u: string) => {
    files++;
    try {
      const res = await safeFetch(u, { ...fetchOpts, maxBytes: 5_000_000, acceptTypes: SITEMAP_TYPES, timeoutMs: Math.min(fetchOpts.timeoutMs ?? 10_000, 10_000) });
      if (res.status !== 200 || !res.body) return null;
      return parseSitemap(res.body);
    } catch {
      return null;
    }
  };
  const add = (entries: SitemapEntry[]) => {
    for (const e of entries) {
      if (out.size >= maxUrls) break;
      if (!out.has(e.url)) out.set(e.url, e);
    }
  };

  for (const sm of candidates.slice(0, 3)) {
    if (files >= maxFiles || out.size >= maxUrls) break;
    const parsed = await load(sm);
    if (!parsed) continue;
    add(parsed.entries);
    // Sitemap index: one level only.
    for (const child of parsed.sitemaps) {
      if (files >= maxFiles || out.size >= maxUrls) break;
      if (opts.isSameSite && !opts.isSameSite(child)) continue;
      const c = await load(child);
      if (c) add(c.entries);
    }
  }
  return [...out.values()];
}

/** URL-only variant of {@link discoverSitemapEntries}. */
export async function discoverSitemapUrls(
  origin: string,
  robotsSitemaps: string[],
  fetchOpts: SafeFetchOptions,
  opts: { maxUrls?: number; maxFiles?: number; isSameSite?: (u: string) => boolean } = {},
): Promise<string[]> {
  return (await discoverSitemapEntries(origin, robotsSitemaps, fetchOpts, opts)).map((e) => e.url);
}
