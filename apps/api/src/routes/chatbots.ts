import { Router } from 'express';
import {
  chatbotConfigSchema,
  createChatbotSchema,
  createSourceSchema,
  previewMessageInputSchema,
  startCrawlSchema,
  updateChatbotSchema,
  updateSourceSchema,
} from '@chatpilot/shared';
import type { AppContext } from '../context';
import { asyncHandler, paginationQuery } from '../lib/http';
import type { RateLimiters } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validate';
import { requireOwnedBot } from '../services/access';

export function chatbotRoutes(ctx: AppContext, rl: RateLimiters): Router {
  const r = Router();
  const owned = (uid: string, id: string) => requireOwnedBot(ctx.store, uid, id);

  r.get('/', asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.list(req.user!.uid, paginationQuery.parse(req.query)));
  }));

  r.post('/', validateBody(createChatbotSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await ctx.chatbots.create(req.user!, req.body));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.get(req.user!.uid, req.params.id));
  }));

  r.patch('/:id', validateBody(updateChatbotSchema), asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.update(req.user!, req.params.id, req.body));
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    await ctx.chatbots.remove(req.user!, req.params.id);
    res.json({ ok: true });
  }));

  r.put('/:id/config', validateBody(chatbotConfigSchema), asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.updateConfig(req.user!, req.params.id, req.body));
  }));

  r.post('/:id/publish', asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.publish(req.user!, req.params.id));
  }));

  r.post('/:id/unpublish', asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.unpublish(req.user!, req.params.id));
  }));

  r.post('/:id/preview-token/rotate', asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.rotatePreviewToken(req.user!, req.params.id));
  }));

  r.get('/:id/install-status', asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.installStatus(req.user!, req.params.id));
  }));

  r.post('/:id/preview/messages', validateBody(previewMessageInputSchema), asyncHandler(async (req, res) => {
    res.json(await ctx.chatbots.preview(req.user!, req.params.id, req.body));
  }));

  // ---- crawl jobs
  r.post('/:id/crawl', rl.crawlStart, validateBody(startCrawlSchema), asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    const plan = await ctx.plans.get(req.user!.planId);
    res.status(202).json(await ctx.crawls.start(bot, plan, req.body));
  }));

  r.get('/:id/crawl-jobs', asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    res.json(await ctx.crawls.list(bot, paginationQuery.parse(req.query)));
  }));

  r.get('/:id/crawl-jobs/:jobId', asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json(await ctx.crawls.get(bot, req.params.jobId));
  }));

  r.post('/:id/crawl-jobs/:jobId/cancel', asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    res.json(await ctx.crawls.cancel(bot, req.params.jobId));
  }));

  // ---- knowledge sources
  r.get('/:id/sources', asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    res.json(await ctx.knowledge.list(bot, paginationQuery.parse(req.query)));
  }));

  r.post('/:id/sources', validateBody(createSourceSchema), asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    const plan = await ctx.plans.get(req.user!.planId);
    res.status(201).json(await ctx.knowledge.create(bot, plan, req.body));
  }));

  r.get('/:id/sources/:sourceId', asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    res.json(await ctx.knowledge.get(bot, req.params.sourceId));
  }));

  r.patch('/:id/sources/:sourceId', validateBody(updateSourceSchema), asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    const plan = await ctx.plans.get(req.user!.planId);
    res.json(await ctx.knowledge.update(bot, plan, req.params.sourceId, req.body));
  }));

  r.delete('/:id/sources/:sourceId', asyncHandler(async (req, res) => {
    const bot = await owned(req.user!.uid, req.params.id);
    await ctx.knowledge.remove(bot, req.params.sourceId);
    res.json({ ok: true });
  }));

  return r;
}
