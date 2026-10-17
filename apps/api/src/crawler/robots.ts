import robotsParser from 'robots-parser';
import { safeFetch, type SafeFetchOptions } from './safeFetch';

export const BOT_TOKEN = 'ChatPilotBot';
/** robots.txt crawl-delay is honoured up to this cap. */
export const MAX_CRAWL_DELAY_MS = 2000;

export interface RobotsRules {
  isAllowed(url: string): boolean;
  crawlDelayMs: number;
  sitemaps: string[];
  /** Set when robots.txt could not be read due to a server error: we then do not crawl. */
  blockedReason?: string;
}

export function parseRobots(robotsUrl: string, content: string): RobotsRules {
  const robots = robotsParser(robotsUrl, content);
  const delay = robots.getCrawlDelay(BOT_TOKEN) ?? robots.getCrawlDelay('*') ?? 0;
  return {
    isAllowed: (url: string) => robots.isAllowed(url, BOT_TOKEN) !== false,
    crawlDelayMs: Math.min(Math.max(0, Number(delay) || 0) * 1000, MAX_CRAWL_DELAY_MS),
    sitemaps: robots.getSitemaps(),
  };
}

const allowAll: RobotsRules = { isAllowed: () => true, crawlDelayMs: 0, sitemaps: [] };

/**
 * Fetches and parses robots.txt for an origin. Per RFC 9309: 4xx means no
 * restrictions; 5xx/unreachable after a successful connection means "assume
 * full disallow" — we stop instead of crawling.
 */
export async function fetchRobots(origin: string, fetchOpts: SafeFetchOptions): Promise<RobotsRules> {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await safeFetch(robotsUrl, {
      ...fetchOpts,
      maxBytes: 500_000,
      timeoutMs: Math.min(fetchOpts.timeoutMs ?? 8000, 8000),
      acceptTypes: ['text/plain', 'text/html', 'application/octet-stream', 'application/xml', 'text/xml'],
    });
    if (res.status >= 500) {
      return { isAllowed: () => false, crawlDelayMs: 0, sitemaps: [], blockedReason: `robots.txt returned HTTP ${res.status}` };
    }
    if (res.status !== 200) return allowAll;
    // An HTML page served at /robots.txt is a soft-404, not a robots file.
    if (/^\s*</.test(res.body)) return allowAll;
    return parseRobots(res.url.endsWith('/robots.txt') ? res.url : robotsUrl, res.body);
  } catch {
    return allowAll;
  }
}
