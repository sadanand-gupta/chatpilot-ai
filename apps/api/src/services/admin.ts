import type {
  ActivityEvent,
  AdminChatbot,
  AdminConversation,
  AdminDailyPoint,
  AdminLead,
  AdminOverview,
  AdminUpdateUserInput,
  AdminUser,
  AdminUserDetail,
  ChatMessage,
  Paginated,
  UserProfile,
} from '@chatpilot/shared';
import type { ActivityQuery, ChatbotRecord, ConversationQuery, ListOpts, Store } from '../data/store';
import { DEMO_OWNER } from '../data/store';
import { conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/http';
import type { Logger } from '../lib/logger';
import type { Retriever } from '../knowledge/retriever';
import { toChatbotDto } from './access';
import type { ActivityService } from './activity';
import type { PlanService } from './plans';
import { searchWindow, toConversation } from './records';
import type { UsageService } from './usage';
import type { UserService } from './users';

const DAY_MS = 86_400_000;
const CHART_DAYS = 14;

/** Who performed an admin action (for the audit log). */
export interface AdminActor {
  uid: string;
  email: string;
  ip?: string;
  userAgent?: string;
}

const norm = (s: string | undefined) => (s ?? '').toLowerCase();

/**
 * Platform admin console: cross-tenant reads and account management. Only reachable through
 * /api/admin behind requireAuth + requireAdmin; every mutation is written to the activity log.
 */
export class AdminService {
  constructor(
    private readonly store: Store,
    private readonly plans: PlanService,
    private readonly usage: UsageService,
    private readonly users: UserService,
    private readonly activity: ActivityService,
    private readonly retriever: Retriever,
    private readonly adminEmails: readonly string[],
    private readonly logger: Logger,
  ) {}

  private isAdminEmail(email: string | undefined): boolean {
    return !!email && this.adminEmails.includes(email.trim().toLowerCase());
  }

  /** Owner emails for a set of uids (demo bots belong to no account). */
  private async emailsFor(uids: Iterable<string>): Promise<Map<string, string>> {
    const unique = [...new Set(uids)].filter((u) => u && u !== DEMO_OWNER);
    const profiles = await Promise.all(unique.map((uid) => this.store.getUser(uid)));
    const out = new Map<string, string>();
    profiles.forEach((p, i) => p && out.set(unique[i], p.email));
    return out;
  }

  private async botsFor(ids: Iterable<string>): Promise<Map<string, ChatbotRecord>> {
    const unique = [...new Set(ids)].filter(Boolean);
    const bots = await Promise.all(unique.map((id) => this.store.getChatbot(id)));
    const out = new Map<string, ChatbotRecord>();
    bots.forEach((b, i) => b && out.set(unique[i], b));
    return out;
  }

  private toAdminChatbot(bot: ChatbotRecord, ownerEmail?: string): AdminChatbot {
    // The preview token is the owner's draft-preview credential; the console never needs it.
    const { previewToken, ...dto } = toChatbotDto(bot);
    return { ...dto, ownerEmail };
  }

  private async toAdminUser(u: UserProfile): Promise<AdminUser> {
    const [chatbotCount, usage] = await Promise.all([this.store.countChatbots(u.uid), this.usage.get(u.uid)]);
    return { ...u, isAdmin: this.isAdminEmail(u.email), chatbotCount, messagesThisMonth: usage.messages };
  }

  async overview(): Promise<AdminOverview> {
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY_MS).toISOString();
    const today = new Date(now);
    const chartStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (CHART_DAYS - 1)));

    const [users, activeUsers7d, chatbots, publishedChatbots, conversations, leads, signUpDates, events, recent] = await Promise.all([
      this.store.countUsers(),
      this.store.countUsers(weekAgo),
      this.store.countTenantChatbots(),
      this.store.countTenantChatbots('published'),
      this.store.countAll('conversations'),
      this.store.countAll('leads'),
      this.store.userCreatedDates(chartStart.toISOString(), 20_000),
      this.store.activitySince(chartStart.toISOString(), 20_000),
      this.store.listActivity({ limit: 15 }),
    ]);

    const days = new Map<string, AdminDailyPoint>();
    for (let i = 0; i < CHART_DAYS; i++) {
      const date = new Date(chartStart.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      days.set(date, { date, signUps: 0, signIns: 0, demos: 0 });
    }
    for (const iso of signUpDates) {
      const d = days.get(iso.slice(0, 10));
      if (d) d.signUps++;
    }
    let demos7d = 0;
    for (const e of events) {
      const d = days.get(e.createdAt.slice(0, 10));
      if (e.type === 'sign_in' || e.type === 'sign_up') {
        if (d) d.signIns++;
      } else if (e.type === 'demo_started') {
        if (d) d.demos++;
        if (e.createdAt >= weekAgo) demos7d++;
      }
    }

    return {
      totals: {
        users,
        newUsers7d: signUpDates.filter((iso) => iso >= weekAgo).length,
        activeUsers7d,
        chatbots,
        publishedChatbots,
        conversations,
        leads,
        demos7d,
      },
      daily: [...days.values()],
      recentActivity: recent.items,
    };
  }

  async listUsers(q: ListOpts & { q?: string }): Promise<Paginated<AdminUser>> {
    let page: Paginated<UserProfile>;
    if (q.q) {
      const needle = q.q.toLowerCase();
      const found = await searchWindow(
        (limit, cursor) => this.store.listUsersNewest({ limit, cursor }).then((p) => ({ ...p, items: p.items.map((u) => ({ ...u, id: u.uid })) })),
        (u) => [u.email, u.displayName, u.businessName].some((f) => norm(f).includes(needle)) || u.uid === q.q,
        (u) => u.createdAt,
        q.limit,
        q.cursor,
      );
      page = { items: found.items.map(({ id, ...u }) => u), nextCursor: found.nextCursor };
    } else {
      page = await this.store.listUsersNewest(q);
    }
    return { items: await Promise.all(page.items.map((u) => this.toAdminUser(u))), nextCursor: page.nextCursor };
  }

  private async requireUser(uid: string): Promise<UserProfile> {
    const user = uid && !uid.includes('/') ? await this.store.getUser(uid) : null;
    if (!user) throw notFound('User');
    return { ...user, uid };
  }

  async getUser(uid: string): Promise<AdminUserDetail> {
    const user = await this.requireUser(uid);
    const [adminUser, plan, usage, bots, activity] = await Promise.all([
      this.toAdminUser(user),
      this.plans.get(user.planId),
      this.usage.get(uid),
      this.store.listAllChatbots(uid, 100),
      this.store.listActivity({ uid, limit: 50 }),
    ]);
    return {
      user: adminUser,
      plan,
      usage,
      chatbots: bots.filter((b) => !b.isDemo).map((b) => this.toAdminChatbot(b, user.email)),
      activity: activity.items,
    };
  }

  /** Guards actions that would lock the admin out or touch another admin. */
  private assertManageable(actor: AdminActor, target: UserProfile, action: string): void {
    if (target.uid === actor.uid) throw conflict(`You can't ${action} your own account.`);
    if (this.isAdminEmail(target.email)) throw conflict(`Admin accounts can't be ${action === 'delete' ? 'deleted' : 'changed this way'} from the console.`);
  }

  async updateUser(actor: AdminActor, uid: string, input: AdminUpdateUserInput): Promise<AdminUser> {
    const user = await this.requireUser(uid);
    const patch: Partial<UserProfile> = {};
    const events: ActivityEvent['type'][] = [];
    if (input.planId !== undefined && input.planId !== user.planId) {
      const plan = await this.plans.get(input.planId);
      if (plan.id !== input.planId) throw notFound('Plan');
      patch.planId = input.planId;
      events.push('admin_plan_changed');
    }
    if (input.suspended !== undefined && input.suspended !== !!user.suspended) {
      this.assertManageable(actor, user, 'suspend');
      patch.suspended = input.suspended;
      events.push(input.suspended ? 'admin_user_suspended' : 'admin_user_restored');
    }
    if (!events.length) return this.toAdminUser(user);
    patch.updatedAt = nowIso();
    await this.store.updateUser(uid, patch);
    for (const type of events) {
      await this.activity.log({
        type,
        uid,
        email: user.email,
        actorEmail: actor.email,
        ip: actor.ip,
        userAgent: actor.userAgent,
        detail: type === 'admin_plan_changed' ? `${user.planId} → ${patch.planId}` : undefined,
      });
    }
    this.logger.info({ uid, by: actor.uid, events }, 'admin updated user');
    return this.toAdminUser({ ...user, ...patch });
  }

  async deleteUser(actor: AdminActor, uid: string): Promise<void> {
    const user = await this.requireUser(uid);
    this.assertManageable(actor, user, 'delete');
    await this.users.deleteAccount(uid);
    await this.activity.log({ type: 'admin_user_deleted', uid, email: user.email, actorEmail: actor.email, ip: actor.ip, userAgent: actor.userAgent });
  }

  async listChatbots(q: ListOpts & { q?: string }): Promise<Paginated<AdminChatbot>> {
    let page: Paginated<ChatbotRecord>;
    if (q.q) {
      const needle = q.q.toLowerCase();
      page = await searchWindow(
        (limit, cursor) => this.store.listTenantChatbots({ limit, cursor }),
        (b) => [b.name, b.businessName, b.websiteUrl, b.publicId].some((f) => norm(f).includes(needle)) || b.id === q.q || b.ownerId === q.q,
        (b) => b.createdAt,
        q.limit,
        q.cursor,
      );
    } else {
      page = await this.store.listTenantChatbots(q);
    }
    const emails = await this.emailsFor(page.items.map((b) => b.ownerId));
    return { items: page.items.map((b) => this.toAdminChatbot(b, emails.get(b.ownerId))), nextCursor: page.nextCursor };
  }

  async deleteChatbot(actor: AdminActor, id: string): Promise<void> {
    const bot = await this.store.getChatbot(id);
    if (!bot) throw notFound('Chatbot');
    const owner = bot.ownerId === DEMO_OWNER ? null : await this.store.getUser(bot.ownerId);
    await this.store.deleteChatbotCascade(bot.id);
    this.retriever.invalidate(bot.id);
    await this.activity.log({
      type: 'admin_chatbot_deleted',
      uid: owner ? bot.ownerId : undefined,
      email: owner?.email,
      actorEmail: actor.email,
      ip: actor.ip,
      userAgent: actor.userAgent,
      chatbotId: bot.id,
      chatbotName: bot.name,
      url: bot.websiteUrl,
    });
  }

  async listConversations(q: ConversationQuery): Promise<Paginated<AdminConversation>> {
    const page = await this.store.listAllConversations(q);
    const [emails, bots] = await Promise.all([this.emailsFor(page.items.map((c) => c.ownerId)), this.botsFor(page.items.map((c) => c.chatbotId))]);
    return {
      items: page.items.map((c) => ({ ...toConversation(c), chatbotName: bots.get(c.chatbotId)?.name, ownerEmail: emails.get(c.ownerId) })),
      nextCursor: page.nextCursor,
    };
  }

  async getConversation(id: string): Promise<{ conversation: AdminConversation; messages: ChatMessage[] }> {
    const conv = await this.store.getConversation(id);
    if (!conv) throw notFound('Conversation');
    const [messages, bot, owner] = await Promise.all([
      this.store.listMessages(id),
      this.store.getChatbot(conv.chatbotId),
      conv.ownerId === DEMO_OWNER ? null : this.store.getUser(conv.ownerId),
    ]);
    return {
      conversation: { ...toConversation(conv), chatbotName: bot?.name, ownerEmail: owner?.email },
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        sources: m.sources,
        fallback: m.fallback,
        createdAt: m.createdAt,
      })),
    };
  }

  async listLeads(opts: ListOpts): Promise<Paginated<AdminLead>> {
    const page = await this.store.listAllLeads(opts);
    const [emails, bots] = await Promise.all([this.emailsFor(page.items.map((l) => l.ownerId)), this.botsFor(page.items.map((l) => l.chatbotId))]);
    return {
      items: page.items.map((l) => ({ ...l, chatbotName: bots.get(l.chatbotId)?.name, ownerEmail: emails.get(l.ownerId) })),
      nextCursor: page.nextCursor,
    };
  }

  listActivity(q: ActivityQuery): Promise<Paginated<ActivityEvent>> {
    return this.store.listActivity(q);
  }
}
