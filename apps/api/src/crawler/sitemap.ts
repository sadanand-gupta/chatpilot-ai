import * as cheerio from 'cheerio';
import { safeFetch, type SafeFetchOptions } from './safeFetch';

const SITEMAP_TYPES = ['application/xml', 'text/xml', 'text/plain', 'application/x-xml', 'text/html'];

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const $ = cheerio.load(xml, { xml: true });
  const urls: string[] = [];
  const sitemaps: string[] = [];
  $('sitemap > loc').each((_, el) => {
    const v = $(el).text().trim();
    if (v) sitemaps.push(v);
  });
  $('url > loc').each((_, el) => {
    const v = $(el).text().trim();
    if (v) urls.push(v);
  });
  if (!urls.length && !sitemaps.length && !/^\s*</.test(xml)) {
    // Plain-text sitemap: one URL per line.
    for (const line of xml.split(/\r?\n/)) if (/^https?:\/\//.test(line.trim())) urls.push(line.trim());
  }
  return { urls, sitemaps };
}

/**
 * Discovers page URLs from /sitemap.xml and robots.txt "Sitemap:" lines,
 * following a sitemap index one level deep. Bounded in files and URLs.
 */
export async function discoverSitemapUrls(
  origin: string,
  robotsSitemaps: string[],
  fetchOpts: SafeFetchOptions,
  opts: { maxUrls?: number; maxFiles?: number; isSameSite?: (u: string) => boolean } = {},
): Promise<string[]> {
  const maxUrls = opts.maxUrls ?? 300;
  const maxFiles = opts.maxFiles ?? 6;
  const candidates = [...new Set([...robotsSitemaps, `${origin}/sitemap.xml`])].filter((u) => !opts.isSameSite || opts.isSameSite(u));
  const out = new Set<string>();
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

  for (const sm of candidates.slice(0, 3)) {
    if (files >= maxFiles || out.size >= maxUrls) break;
    const parsed = await load(sm);
    if (!parsed) continue;
    parsed.urls.forEach((u) => out.size < maxUrls && out.add(u));
    // Sitemap index: one level only.
    for (const child of parsed.sitemaps) {
      if (files >= maxFiles || out.size >= maxUrls) break;
      if (opts.isSameSite && !opts.isSameSite(child)) continue;
      const c = await load(child);
      c?.urls.forEach((u) => out.size < maxUrls && out.add(u));
    }
  }
  return [...out];
}
