import { Router, type Request } from 'express';
import { z } from 'zod';
import type { ActivityEventType, PlanId } from '@chatpilot/shared';
import type { AppContext } from '../context';
import { asyncHandler, clientIp, paginationQuery } from '../lib/http';
import { validateBody } from '../middleware/validate';
import { userAgentOf } from '../services/activity';
import type { AdminActor } from '../services/admin';

const ACTIVITY_TYPES = [
  'sign_up',
  'sign_in',
  'demo_started',
  'chatbot_created',
  'chatbot_published',
  'chatbot_deleted',
  'account_deleted',
  'admin_plan_changed',
  'admin_user_suspended',
  'admin_user_restored',
  'admin_user_deleted',
  'admin_chatbot_deleted',
] as const satisfies readonly ActivityEventType[];

const PLAN_IDS = ['free', 'starter', 'pro', 'business'] as const satisfies readonly PlanId[];

const searchQuery = paginationQuery.extend({ q: z.string().trim().max(200).optional() });

const updateUserSchema = z
  .object({ planId: z.enum(PLAN_IDS).optional(), suspended: z.boolean().optional() })
  .strict()
  .refine((v) => v.planId !== undefined || v.suspended !== undefined, { message: 'Nothing to update' });

const actor = (req: Request): AdminActor => ({ uid: req.user!.uid, email: req.user!.email, ip: clientIp(req), userAgent: userAgentOf(req) });

/** /api/admin/* — mounted behind requireAuth + requireAdmin (platform admins only). */
export function adminConsoleRoutes(ctx: AppContext): Router {
  const r = Router();

  r.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  r.get('/overview', asyncHandler(async (_req, res) => {
    res.json(await ctx.admin.overview());
  }));

  r.get('/users', asyncHandler(async (req, res) => {
    const q = searchQuery.parse(req.query);
    res.json(await ctx.admin.listUsers({ ...q, q: q.q || undefined }));
  }));

  r.get('/users/:uid', asyncHandler(async (req, res) => {
    res.json(await ctx.admin.getUser(req.params.uid));
  }));

  r.patch('/users/:uid', validateBody(updateUserSchema), asyncHandler(async (req, res) => {
    res.json(await ctx.admin.updateUser(actor(req), req.params.uid, req.body));
  }));

  r.delete('/users/:uid', asyncHandler(async (req, res) => {
    await ctx.admin.deleteUser(actor(req), req.params.uid);
    res.json({ ok: true });
  }));

  r.get('/chatbots', asyncHandler(async (req, res) => {
    const q = searchQuery.parse(req.query);
    res.json(await ctx.admin.listChatbots({ ...q, q: q.q || undefined }));
  }));

  r.delete('/chatbots/:id', asyncHandler(async (req, res) => {
    await ctx.admin.deleteChatbot(actor(req), req.params.id);
    res.json({ ok: true });
  }));

  r.get('/conversations', asyncHandler(async (req, res) => {
    const q = paginationQuery.extend({ chatbotId: z.string().max(100).optional() }).parse(req.query);
    res.json(await ctx.admin.listConversations({ ...q, chatbotId: q.chatbotId || undefined }));
  }));

  r.get('/conversations/:id', asyncHandler(async (req, res) => {
    res.json(await ctx.admin.getConversation(req.params.id));
  }));

  r.get('/leads', asyncHandler(async (req, res) => {
    res.json(await ctx.admin.listLeads(paginationQuery.parse(req.query)));
  }));

  r.get('/activity', asyncHandler(async (req, res) => {
    const q = paginationQuery
      .extend({ type: z.enum(ACTIVITY_TYPES).optional().or(z.literal('').transform(() => undefined)), uid: z.string().max(128).optional() })
      .parse(req.query);
    res.json(await ctx.admin.listActivity({ ...q, uid: q.uid || undefined }));
  }));

  return r;
}
