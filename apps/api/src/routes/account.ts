import { Router } from 'express';
import { updateProfileSchema } from '@chatpilot/shared';
import { z } from 'zod';
import type { AppContext } from '../context';
import { asyncHandler, isoDateParam, paginationQuery } from '../lib/http';
import { validateBody } from '../middleware/validate';
import { actorOf } from '../services/activity';

/** /api/me, /api/plans, /api/dashboard, /api/conversations, /api/leads */
export function accountRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get('/me', asyncHandler(async (req, res) => {
    res.json({ ...(await ctx.users.me(req.user!)), isAdmin: !!req.isAdmin });
  }));

  r.patch('/me', validateBody(updateProfileSchema), asyncHandler(async (req, res) => {
    res.json({ ...(await ctx.users.updateProfile(req.user!, req.body)), isAdmin: !!req.isAdmin });
  }));

  r.delete('/me', asyncHandler(async (req, res) => {
    await ctx.users.deleteAccount(req.user!.uid);
    await ctx.activity.log({ type: 'account_deleted', ...actorOf(req) });
    res.json({ ok: true });
  }));

  r.get('/plans', asyncHandler(async (_req, res) => {
    res.json({ items: await ctx.plans.list() });
  }));

  r.get('/dashboard/stats', asyncHandler(async (req, res) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).parse(req.query);
    res.json(await ctx.stats.dashboard(req.user!, days));
  }));

  const convQuery = paginationQuery.extend({
    chatbotId: z.string().max(100).optional(),
    from: isoDateParam.optional(),
    to: isoDateParam.optional(),
    q: z.string().trim().max(200).optional(),
  });

  r.get('/conversations', asyncHandler(async (req, res) => {
    const q = convQuery.parse(req.query);
    res.json(await ctx.records.listConversations(req.user!.uid, { ...q, q: q.q || undefined }));
  }));

  r.get('/conversations/:id', asyncHandler(async (req, res) => {
    res.json(await ctx.records.getConversation(req.user!.uid, req.params.id));
  }));

  r.delete('/conversations/:id', asyncHandler(async (req, res) => {
    await ctx.records.deleteConversation(req.user!.uid, req.params.id);
    res.json({ ok: true });
  }));

  const leadQuery = paginationQuery.extend({
    chatbotId: z.string().max(100).optional(),
    q: z.string().trim().max(200).optional(),
  });

  r.get('/leads/export.csv', asyncHandler(async (req, res) => {
    const { chatbotId } = z.object({ chatbotId: z.string().max(100).optional() }).parse(req.query);
    const csv = await ctx.records.exportLeadsCsv(req.user!, chatbotId || undefined);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }));

  r.get('/leads', asyncHandler(async (req, res) => {
    const q = leadQuery.parse(req.query);
    res.json(await ctx.records.listLeads(req.user!.uid, { ...q, q: q.q || undefined }));
  }));

  r.delete('/leads/:id', asyncHandler(async (req, res) => {
    await ctx.records.deleteLead(req.user!.uid, req.params.id);
    res.json({ ok: true });
  }));

  return r;
}
