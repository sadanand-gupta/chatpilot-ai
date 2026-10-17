import type { CrawlPageResult, SiteMeta } from '@chatpilot/shared';
import { extractPage, extractPlainText, extractSiteMeta, looksLikeChallenge, removeBoilerplate, type ExtractedPage } from './extract';
import { fetchRobots, type RobotsRules } from './robots';
import { FetchError, safeFetch, type RawLookup, type SafeFetchOptions } from './safeFetch';
import { discoverSitemapEntries } from './sitemap';
import { parseAndCheckUrl, UrlBlockedError, type UrlSafetyOptions } from './urlSafety';

/**
 * Polite, bounded, same-site crawler.
 * - robots.txt respected (ChatPilotBot and *), crawl-delay honoured up to 2 s.
 * - sitemap.xml + robots Sitemap: lines used for discovery.
 * - Pages prioritised by business-relevant path keywords.
 * - Never bypasses logins, CAPTCHAs or anti-bot protection: such pages are skipped.
 */

export interface CrawlOptions extends UrlSafetyOptions {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  pageTimeoutMs: number;
  maxPageBytes: number;
  userAgent: string;
  signal?: AbortSignal;
  lookup?: RawLookup;
  /** Stop adding pages once this much text was collected. */
  maxTotalChars?: number;
  useSitemap?: boolean;
  onPage?: (result: CrawlPageResult, stats: CrawlStats) => void | Promise<void>;
}

export interface CrawlStats {
  discovered: number;
  processed: number;
  skipped: number;
  failed: number;
}

export interface CrawledPage extends ExtractedPage {
  depth: number;
}

export interface CrawlOutput {
  pages: CrawledPage[];
  results: CrawlPageResult[];
  stats: CrawlStats;
  siteMeta?: SiteMeta;
  /** Fatal problem (start page unreachable, robots disallow…). */
  error?: string;
  errorCode?: 'crawl_blocked' | 'invalid_url' | 'unreachable';
  hint?: string;
  totalChars: number;
  cancelled: boolean;
}

export const JS_SITE_HINT =
  'We could not read much text from this website. It is probably rendered with JavaScript (a single-page app), which our crawler cannot execute. Add your key information manually (FAQ entries or a text source) so the chatbot can answer questions.';

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|yclid|dclid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|hsctatracking|ref|ref_src|igshid|si|spm|share|amp)$/i;
const SKIP_EXT =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|mp[34]|m4[av]|wav|ogg|avi|mov|wmv|webm|mkv|flv|zip|rar|7z|gz|tgz|tar|bz2|exe|msi|dmg|apk|ipa|iso|bin|css|js|mjs|map|json|rss|atom|csv|xlsx?|docx?|pptx?|odt|ods|woff2?|ttf|eot|otf|ics|vcf|xml)$/i;

const HIGH_PRIORITY = /(^|\/|-|_)(home|about|about-us|who-we-are|services?|products?|pricing|prices?|plans?|packages?|fees|faqs?|questions|contact|contact-us|support|help|team|our-team|staff|doctors?|book|booking|appointments?|reserve|courses?|programs?|classes|menu|locations?|branches|stores?|visit|hours|shipping|delivery|returns?|refunds?|treatments?|solutions?|features|how-it-works|offers?|catalog(ue)?|shop)(\/|$|\.|-|_)/i;
const LOW_PRIORITY = /(\/page\/\d+|[?&](page|p|paged)=\d+|\/tags?\/|\/author\/|\/feed\/?|\/(login|log-in|signin|sign-in|signup|sign-up|register|cart|basket|checkout|account|my-account|wishlist|wp-admin|wp-login|admin|privacy|privacy-policy|terms|terms-of-service|terms-and-conditions|cookie|cookies|legal|disclaimer|sitemap)(\/|$|\.|-))/i;
const BLOG_RE = /\/(blog|news|articles?|posts?|stories|press)\//i;

export const siteKey = (hostname: string): string => hostname.toLowerCase().replace(/^www\./, '');

/** Canonical form used for fetching and de-duplication. */
export function canonicalUrl(input: string | URL): string | null {
  let u: URL;
  try {
    u = new URL(typeof input === 'string' ? input : input.href);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a], [b]) => a.localeCompare(b));
  u.search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  u.pathname = u.pathname.replace(/\/index\.(html?|php|aspx?)$/i, '/');
  return u.href;
}

export function priorityOf(url: string, depth: number): number {
  let path = url;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    /* keep raw */
  }
  let score = depth * 10 + path.split('/').filter(Boolean).length * 2;
  if (path === '/' || path === '') score -= 100;
  if (HIGH_PRIORITY.test(path)) score -= 15;
  if (BLOG_RE.test(path)) score += 6;
  if (LOW_PRIORITY.test(path)) score += 60;
  if (path.includes('?')) score += 5;
  return score;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

interface FrontierItem {
  url: string;
  depth: number;
  priority: number;
  family: string;
}

/**
 * Parent path of a URL ("/locations/chennai" -> "/locations/"). Templated sections
 * (city pages, blog posts, product variants) share a family; top-level pages each have their own.
 */
export function familyOf(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  return parts.length < 2 ? `top:${parts[0] ?? ''}` : `/${parts.slice(0, -1).join('/')}/`;
}

/** Extra cost per page already taken from a large family, so a small page budget covers distinct pages first. */
export const FAMILY_PENALTY = 40;
export const FAMILY_FREE_PAGES = 1;
export const LARGE_FAMILY = 4;

export async function crawlSite(opts: CrawlOptions): Promise<CrawlOutput> {
  const stats: CrawlStats = { discovered: 0, processed: 0, skipped: 0, failed: 0 };
  const results: CrawlPageResult[] = [];
  const pages: CrawledPage[] = [];
  const out = (extra: Partial<CrawlOutput>): CrawlOutput => {
    const cleaned = removeBoilerplate(pages);
    const totalChars = cleaned.reduce((n, p) => n + p.text.length, 0);
    return { pages: cleaned, results, stats, totalChars, cancelled: !!opts.signal?.aborted, ...extra };
  };

  let start: URL;
  try {
    start = parseAndCheckUrl(opts.startUrl, opts);
  } catch (e) {
    return out({ error: (e as Error).message, errorCode: 'invalid_url' });
  }

  const fetchOpts: SafeFetchOptions = {
    userAgent: opts.userAgent,
    timeoutMs: opts.pageTimeoutMs,
    maxBytes: opts.maxPageBytes,
    allowPrivateForTests: opts.allowPrivateForTests,
    signal: opts.signal,
    lookup: opts.lookup,
  };

  let site = siteKey(start.hostname);
  const sameSite = (u: string) => {
    try {
      const x = new URL(u);
      return siteKey(x.hostname) === site && (x.protocol === 'https:' || x.protocol === 'http:');
    } catch {
      return false;
    }
  };

  const robots: RobotsRules = await fetchRobots(start.origin, fetchOpts);
  if (robots.blockedReason) {
    return out({ error: `This website's robots.txt could not be read (${robots.blockedReason}), so we did not crawl it.`, errorCode: 'crawl_blocked' });
  }
  if (!robots.isAllowed(start.href)) {
    return out({ error: "This website's robots.txt does not allow ChatPilotBot to crawl it.", errorCode: 'crawl_blocked' });
  }

  const seen = new Set<string>();
  const frontier: FrontierItem[] = [];
  const MAX_FRONTIER = 3000;
  const familySize = new Map<string, number>();
  const familyTaken = new Map<string, number>();
  /** bonus < 0 raises priority (home-page navigation links, high sitemap priority). */
  const enqueue = (raw: string, depth: number, bonus = 0) => {
    if (seen.size >= MAX_FRONTIER) return;
    const c = canonicalUrl(raw);
    if (!c) return;
    if (seen.has(c)) {
      // Already queued (e.g. from the sitemap) — still apply a better bonus (e.g. it's in the main nav).
      const queued = bonus < 0 ? frontier.find((f) => f.url === c) : undefined;
      if (queued) queued.priority = Math.min(queued.priority, priorityOf(c, depth) + bonus);
      return;
    }
    if (!sameSite(c)) return;
    const path = new URL(c).pathname;
    if (SKIP_EXT.test(path)) return;
    if (depth > opts.maxDepth) return;
    if (!robots.isAllowed(c)) return;
    seen.add(c);
    stats.discovered++;
    const family = familyOf(c);
    familySize.set(family, (familySize.get(family) ?? 0) + 1);
    frontier.push({ url: c, depth, priority: priorityOf(c, depth) + bonus, family });
  };

  enqueue(start.href, 0);
  if (opts.useSitemap !== false && !opts.signal?.aborted) {
    const fromSitemap = await discoverSitemapEntries(start.origin, robots.sitemaps, fetchOpts, { isSameSite: sameSite, maxUrls: 300 }).catch(() => []);
    // <priority> 0..1 -> up to 8 points of bonus (a tie-breaker, not a trump card).
    for (const e of fromSitemap) enqueue(e.url, 1, e.priority !== undefined ? -Math.round(e.priority * 8) : 0);
  }

  const contentHashes = new Set<string>();
  let nextSlot = 0;
  let attempts = 0;
  let totalChars = 0;
  let siteMeta: SiteMeta | undefined;
  let startError: string | undefined;
  const maxAttempts = opts.maxPages * 2 + 5;

  const record = async (r: CrawlPageResult) => {
    if (r.status === 'processed') stats.processed++;
    else if (r.status === 'skipped') stats.skipped++;
    else stats.failed++;
    results.push(r);
    try {
      await opts.onPage?.(r, { ...stats });
    } catch {
      /* progress reporting must never break the crawl */
    }
  };

  const effectivePriority = (f: FrontierItem) => {
    if (f.family.startsWith('top:') || (familySize.get(f.family) ?? 0) < LARGE_FAMILY) return f.priority;
    const taken = familyTaken.get(f.family) ?? 0;
    return f.priority + Math.max(0, taken - FAMILY_FREE_PAGES + 1) * FAMILY_PENALTY;
  };
  const takeNext = (): FrontierItem | undefined => {
    if (!frontier.length) return undefined;
    let best = 0;
    let bestScore = effectivePriority(frontier[0]);
    for (let i = 1; i < frontier.length; i++) {
      const score = effectivePriority(frontier[i]);
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    const item = frontier.splice(best, 1)[0];
    familyTaken.set(item.family, (familyTaken.get(item.family) ?? 0) + 1);
    return item;
  };

  const done = () =>
    !!opts.signal?.aborted ||
    stats.processed >= opts.maxPages ||
    attempts >= maxAttempts ||
    (opts.maxTotalChars !== undefined && totalChars >= opts.maxTotalChars);

  const processOne = async (item: FrontierItem) => {
    // Shared politeness gate (crawl-delay) across workers.
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + robots.crawlDelayMs;
    await sleep(wait, opts.signal);
    if (opts.signal?.aborted) return;

    let res;
    try {
      try {
        res = await safeFetch(item.url, fetchOpts);
      } catch (first) {
        // Slow sites time out intermittently: retry once after a short pause.
        if (!(first instanceof FetchError && first.code === 'timeout') || opts.signal?.aborted) throw first;
        await new Promise((r) => setTimeout(r, 1500));
        res = await safeFetch(item.url, fetchOpts);
      }
    } catch (e) {
      if (opts.signal?.aborted) return;
      const reason =
        e instanceof UrlBlockedError || (e instanceof FetchError && e.code === 'blocked')
          ? 'Blocked for security (private network address)'
          : e instanceof FetchError
          ? e.code === 'unsupported_type'
            ? 'Not an HTML page'
            : e.code === 'blocked'
              ? 'Blocked for security (private network address)'
              : e.code === 'timeout'
                ? 'Timed out'
                : e.message
          : 'Could not fetch page';
      if (item.depth === 0) startError = reason;
      await record({ url: item.url, status: e instanceof FetchError && e.code === 'unsupported_type' ? 'skipped' : 'failed', reason });
      return;
    }

    const finalUrl = canonicalUrl(res.url) ?? res.url;
    if (item.depth === 0 && res.redirects.length) {
      // e.g. example.com -> www.example.com: adopt the final host as "the site".
      site = siteKey(new URL(finalUrl).hostname);
    }
    if (finalUrl !== item.url) {
      if (!sameSite(finalUrl)) {
        await record({ url: item.url, status: 'skipped', reason: 'Redirects to another website' });
        return;
      }
      if (seen.has(finalUrl) && item.depth > 0) {
        await record({ url: item.url, status: 'skipped', reason: 'Duplicate (redirect)' });
        return;
      }
      seen.add(finalUrl);
    }

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      const reason = res.status === 429 ? 'Rate limited by the website (HTTP 429)' : `Access denied (HTTP ${res.status}) - login or bot protection`;
      if (item.depth === 0) startError = reason;
      await record({ url: item.url, status: 'skipped', reason });
      return;
    }
    if (res.status < 200 || res.status >= 300) {
      if (item.depth === 0) startError = `The website returned HTTP ${res.status}`;
      await record({ url: item.url, status: 'failed', reason: `HTTP ${res.status}` });
      return;
    }
    const mime = res.contentType.split(';')[0].trim();
    if (mime === 'application/xml' || mime === 'text/xml') {
      await record({ url: item.url, status: 'skipped', reason: 'Not an HTML page' });
      return;
    }
    if (looksLikeChallenge(res.body)) {
      if (item.depth === 0) startError = 'The website shows a bot-protection challenge (CAPTCHA), which we do not bypass.';
      await record({ url: item.url, status: 'skipped', reason: 'Bot protection / CAPTCHA detected' });
      return;
    }

    const isPlain = mime === 'text/plain';
    let page: ExtractedPage;
    try {
      page = isPlain ? extractPlainText(res.body, finalUrl) : extractPage(res.body, finalUrl);
    } catch {
      await record({ url: item.url, status: 'failed', reason: 'Could not parse HTML' });
      return;
    }
    if (item.depth === 0 && !isPlain) {
      try {
        siteMeta = extractSiteMeta(res.body, finalUrl);
      } catch {
        /* optional */
      }
    }
    if (!isPlain && /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(res.body.slice(0, 20000)) && item.depth > 0) {
      await record({ url: item.url, status: 'skipped', reason: 'Page asks not to be indexed (noindex)' });
      return;
    }
    // Links on the start page (its navigation) describe the site's main sections.
    const navBonus = item.depth === 0 ? -12 : 0;
    for (const link of page.links) enqueue(link, item.depth + 1, navBonus);

    if (page.text.length < 50) {
      await record({ url: item.url, status: 'skipped', title: page.title, reason: 'No readable text (the page may require JavaScript)', chars: page.text.length });
      return;
    }
    if (contentHashes.has(page.hash)) {
      await record({ url: item.url, status: 'skipped', title: page.title, reason: 'Duplicate content' });
      return;
    }
    if (stats.processed >= opts.maxPages) return;
    contentHashes.add(page.hash);
    pages.push({ ...page, depth: item.depth });
    totalChars += page.text.length;
    await record({ url: finalUrl, status: 'processed', title: page.title, chars: page.text.length });
  };

  const inflight = new Set<Promise<void>>();
  const concurrency = Math.max(1, opts.concurrency);
  // The start page is crawled alone first so redirects (apex -> www) set the site host.
  const first = takeNext();
  if (first) {
    attempts++;
    await processOne(first);
  }
  while (!done()) {
    while (inflight.size < concurrency && !done() && stats.processed + inflight.size < opts.maxPages) {
      const item = takeNext();
      if (!item) break;
      attempts++;
      const p = processOne(item).finally(() => inflight.delete(p));
      inflight.add(p);
    }
    if (!inflight.size) break;
    await Promise.race(inflight);
  }
  await Promise.allSettled([...inflight]);

  const result = out({ siteMeta });
  if (result.cancelled) return result;
  if (!result.pages.length && startError) {
    return { ...result, error: `We could not read ${start.hostname}: ${startError}`, errorCode: 'unreachable' };
  }
  if (result.totalChars < 200) result.hint = JS_SITE_HINT;
  return result;
}
