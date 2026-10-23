import { Router, type Request } from 'express';
import { chatMessageInputSchema, demoInputSchema, leadInputSchema } from '@chatpilot/shared';
import { z } from 'zod';
import type { AppContext } from '../context';
import { asyncHandler, clientIp } from '../lib/http';
import type { RateLimiters } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { userAgentOf } from '../services/activity';

/** Preview token from the X-Preview-Token header (preferred) or the legacy query/body field. */
const previewTokenOf = (req: Request, fallback?: unknown): string | undefined => {
  const h = req.headers['x-preview-token'];
  const v = typeof h === 'string' && h ? h : typeof fallback === 'string' ? fallback : undefined;
  return v ? v.slice(0, 100) : undefined;
};

const meta = (req: Request) => ({ origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined, ip: clientIp(req) });

export function publicRoutes(ctx: AppContext, rl: RateLimiters): Router {
  const r = Router();

  r.get('/plans', asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ items: await ctx.plans.list() });
  }));

  r.get(
    '/chatbots/:publicId/config',
    rl.publicConfig,
    asyncHandler(async (req, res) => {
      const previewToken = previewTokenOf(req, req.query.previewToken);
      const cfg = await ctx.publicChat.publicConfig(req.params.publicId, previewToken, meta(req));
      res.set('Cache-Control', previewToken ? 'no-store' : 'public, max-age=30');
      res.json(cfg);
    }),
  );

  r.post(
    '/chatbots/:publicId/messages',
    rl.publicChatIp,
    rl.publicChatBot,
    validateBody(chatMessageInputSchema),
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const previewToken = previewTokenOf(req, req.body.previewToken);
      res.json(await ctx.publicChat.message(req.params.publicId, { ...req.body, previewToken }, meta(req)));
    }),
  );

  r.post(
    '/chatbots/:publicId/leads',
    rl.leads,
    validateBody(leadInputSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(await ctx.publicChat.lead(req.params.publicId, req.body, meta(req)));
    }),
  );

  r.post(
    '/demo',
    rl.demo,
    validateBody(demoInputSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json(await ctx.demo.create(req.body.url, clientIp(req), userAgentOf(req)));
    }),
  );

  r.get(
    '/demo/:demoId',
    rl.demoPoll,
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await ctx.demo.get(req.params.demoId));
    }),
  );

  r.get(
    '/frame-check',
    rl.frameCheck,
    asyncHandler(async (req, res) => {
      const { url } = z.object({ url: z.string().trim().min(3).max(2048) }).parse(req.query);
      res.json(await ctx.frameChecker.check(url));
    }),
  );

  return r;
}
