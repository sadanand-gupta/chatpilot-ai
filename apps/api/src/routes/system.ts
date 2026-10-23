import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { unauthorized } from '../lib/errors';
import { safeEqual } from '../lib/hmac';
import { asyncHandler } from '../lib/http';
import { signDevToken } from '../middleware/auth';
import type { RateLimiters } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';

export function healthRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get('/health', asyncHandler(async (req, res) => {
    const aiOk = await ctx.ai.health();
    res.set('Cache-Control', 'no-store');
    const token = req.headers['x-admin-token'];
    // Full details only for operators (valid admin token) or outside production.
    const detailed =
      ctx.env.NODE_ENV !== 'production' || (typeof token === 'string' && !!ctx.env.ADMIN_TOKEN && safeEqual(token, ctx.env.ADMIN_TOKEN));
    if (!detailed) {
      res.json({ ok: true, ai: { ok: aiOk } });
      return;
    }
    res.json({
      ok: true,
      ai: { provider: ctx.ai.name, ok: aiOk },
      store: ctx.store.kind,
      authMode: ctx.env.AUTH_MODE,
      devMode: ctx.env.devMode,
    });
  }));
  return r;
}

/** Serves the widget bundle built by apps/widget. */
export function widgetRoutes(ctx: AppContext): Router {
  const r = Router();
  let cache: { mtimeMs: number; body: Buffer } | null = null;
  const serve = (_req: Request, res: Response) => {
    const file = path.join(ctx.env.WIDGET_DIST_DIR, 'widget.js');
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      res.status(503).set('Access-Control-Allow-Origin', '*').json({
        error: { code: 'internal', message: 'The widget bundle has not been built yet. Run: npm run build -w @chatpilot/widget' },
      });
      return;
    }
    if (!cache || cache.mtimeMs !== stat.mtimeMs) cache = { mtimeMs: stat.mtimeMs, body: fs.readFileSync(file) };
    res.set({
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(cache.body);
  };
  r.get('/widget.js', serve);
  r.get('/widget/v1/widget.js', serve);
  return r;
}

/** DEV ONLY — mounted only when AUTH_MODE=dev and NODE_ENV!=production. */
export function devRoutes(ctx: AppContext, rl: RateLimiters): Router {
  const r = Router();
  r.post(
    '/login',
    rl.devLogin,
    validateBody(z.object({ email: z.string().trim().email().max(200), displayName: z.string().trim().max(120).optional() })),
    asyncHandler(async (req, res) => {
      const t = await signDevToken(ctx.env.DEV_JWT_SECRET, req.body.email);
      await ctx.users.ensureUser(t.uid, t.email, req.body.displayName);
      res.json(t);
    }),
  );
  return r;
}

/** Operator endpoints for schedulers/scripts, authenticated with the X-Admin-Token header. */
export function adminTokenRoutes(ctx: AppContext): Router {
  const r = Router();
  const requireToken = (req: Request, _res: Response, next: (err?: unknown) => void) => {
    const token = req.headers['x-admin-token'];
    if (!ctx.env.ADMIN_TOKEN || typeof token !== 'string' || !safeEqual(token, ctx.env.ADMIN_TOKEN)) return next(unauthorized('Admin token required'));
    next();
  };
  r.post('/cleanup', requireToken, asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...(await ctx.cleanup.run()) });
  }));
  return r;
}
