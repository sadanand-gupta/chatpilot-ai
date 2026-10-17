import type { ActivityItem, DashboardStats, UserProfile } from '@chatpilot/shared';
import type { Store } from '../data/store';
import type { PlanService } from './plans';
import type { UsageService } from './usage';

/** Dashboard stats computed from real data. */
export class StatsService {
  constructor(
    private readonly store: Store,
    private readonly plans: PlanService,
    private readonly usage: UsageService,
  ) {}

  async dashboard(user: UserProfile, days: number): Promise<DashboardStats> {
    const uid = user.uid;
    const now = new Date();
    const startDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
    const fromIso = startDay.toISOString();

    const [bots, dates, leadsCount, usage, plan, recentConvs, recentLeads, recentJobs] = await Promise.all([
      this.store.listAllChatbots(uid),
      this.store.conversationCreatedDates(uid, fromIso, 20_000),
      this.store.countLeads(uid, fromIso),
      this.usage.get(uid),
      this.plans.get(user.planId),
      this.store.listConversations(uid, { limit: 5 }),
      this.store.listLeads(uid, { limit: 5 }),
      this.store.listRecentCrawlJobs(uid, 5).catch(() => []),
    ]);

    const tenantBots = bots.filter((b) => !b.isDemo);
    const names = new Map(tenantBots.map((b) => [b.id, b.name]));

    const buckets = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(startDay.getTime() + i * 86_400_000);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const iso of dates) {
      const key = iso.slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const activity: ActivityItem[] = [];
    for (const c of recentConvs.items) {
      activity.push({
        type: 'conversation',
        chatbotId: c.chatbotId,
        chatbotName: names.get(c.chatbotId) ?? 'Chatbot',
        message: `New conversation: "${(c.lastMessagePreview ?? '').slice(0, 80)}"`,
        at: c.lastMessageAt,
      });
    }
    for (const l of recentLeads.items) {
      activity.push({
        type: 'lead',
        chatbotId: l.chatbotId,
        chatbotName: names.get(l.chatbotId) ?? 'Chatbot',
        message: `New lead${l.name ? ` from ${l.name}` : ''}`,
        at: l.createdAt,
      });
    }
    for (const j of recentJobs) {
      if (!names.has(j.chatbotId)) continue;
      activity.push({
        type: 'crawl',
        chatbotId: j.chatbotId,
        chatbotName: names.get(j.chatbotId)!,
        message: `Website crawl ${j.status}${j.stats?.processed ? ` (${j.stats.processed} pages)` : ''}`,
        at: j.finishedAt ?? j.startedAt ?? j.createdAt,
      });
    }
    for (const b of tenantBots) {
      if (b.publishedAt) activity.push({ type: 'publish', chatbotId: b.id, chatbotName: b.name, message: `Published version ${b.publishedVersion}`, at: b.publishedAt });
      activity.push({ type: 'chatbot_created', chatbotId: b.id, chatbotName: b.name, message: 'Chatbot created', at: b.createdAt });
    }
    activity.sort((a, b) => (a.at < b.at ? 1 : -1));

    return {
      chatbots: {
        total: tenantBots.length,
        published: tenantBots.filter((b) => b.status === 'published').length,
        draft: tenantBots.filter((b) => b.status !== 'published').length,
      },
      conversations: { count: dates.length, days, series: [...buckets].map(([date, count]) => ({ date, count })) },
      leads: { count: leadsCount, days },
      usage,
      plan,
      recentActivity: activity.slice(0, 10),
    };
  }
}
