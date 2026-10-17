import type { Request, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import type { Env } from '../config/env';
import ipaddr from 'ipaddr.js';
import { clientIp } from '../lib/http';

/**
 * In-memory rate limiters. NOTE: the default store is per-process; with several
 * instances each instance counts separately (use a shared store such as Redis
 * when scaling horizontally).
 */

const ipKey = (req: Request): string => {
  const ip = clientIp(req);
  // Group IPv6 clients by /64 so a single host cannot rotate through its addresses.
  try {
    let addr = ipaddr.parse(ip);
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
    if (addr.kind() === 'ipv6') return (addr as ipaddr.IPv6).toNormalizedString().split(':').slice(0, 4).join(':') + '::/64';
    return addr.toString();
  } catch {
    return ip;
  }
};

function limiter(windowMs: number, limit: number, keyGenerator: (req: Request) => string, message: string) {
  const opts: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    validate: { trustProxy: false, xForwardedForHeader: false, ip: false },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ error: { code: 'rate_limited', message } });
    },
  };
  return rateLimit(opts);
}

export function createRateLimiters(env: Env) {
  return {
    global: limiter(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX_REQUESTS, ipKey, 'Too many requests, please slow down.'),
    publicChatIp: limiter(60_000, env.PUBLIC_CHAT_RATE_LIMIT, (req) => `ip:${ipKey(req)}`, 'You are sending messages too quickly. Please wait a moment.'),
    publicChatBot: limiter(
      60_000,
      env.PUBLIC_CHAT_RATE_LIMIT * 10,
      (req) => `bot:${String(req.params.publicId ?? '')}`,
      'This assistant is receiving too many messages right now. Please try again shortly.',
    ),
    publicConfig: limiter(60_000, Math.max(60, env.RATE_LIMIT_MAX_REQUESTS), ipKey, 'Too many requests, please slow down.'),
    leads: limiter(60_000, env.LEADS_RATE_LIMIT, (req) => `lead:${ipKey(req)}`, 'Too many submissions. Please wait a minute and try again.'),
    demo: limiter(60 * 60_000, env.DEMO_PER_IP_PER_HOUR, (req) => `demo:${ipKey(req)}`, 'You have created several demos recently. Please try again in an hour or sign up for free.'),
    demoPoll: limiter(60_000, 120, ipKey, 'Too many requests, please slow down.'),
    frameCheck: limiter(60_000, 20, (req) => `frame:${ipKey(req)}`, 'Too many frame checks, please slow down.'),
    crawlStart: limiter(60 * 60_000, env.CRAWL_START_RATE_LIMIT, (req) => `crawl:${req.user?.uid ?? ipKey(req)}`, 'Too many crawls started. Please wait before starting another.'),
    privateUser: limiter(env.RATE_LIMIT_WINDOW_MS, env.PRIVATE_RATE_LIMIT_PER_USER, (req) => `user:${req.user?.uid ?? ipKey(req)}`, 'Too many requests, please slow down.'),
    devLogin: limiter(60_000, 30, ipKey, 'Too many requests.'),
  };
}

export type RateLimiters = ReturnType<typeof createRateLimiters>;
