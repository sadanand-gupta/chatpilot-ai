import type { Store } from '../data/store';
import type { Logger } from '../lib/logger';
import type { Retriever } from '../knowledge/retriever';
import type { PlanService } from './plans';

/**
 * Retention + demo expiry. Firestore TTL on `expiresAt` deletes top-level demo
 * docs eventually (Blaze plan only) but never subcollections, so this job
 * cascade-deletes expired demo bots (sources, chunks, crawlJobs, versions,
 * conversations, publicConfigs pointer) and conversations older than the
 * owner's plan retentionDays.
 */
export class CleanupService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly plans: PlanService,
    private readonly retriever: Retriever,
    private readonly logger: Logger,
  ) {}

  async run(): Promise<{ expiredDemos: number; conversationsDeleted: number }> {
    if (this.running) return { expiredDemos: 0, conversationsDeleted: 0 };
    this.running = true;
    let expiredDemos = 0;
    let conversationsDeleted = 0;
    try {
      const now = new Date().toISOString();
      for (let i = 0; i < 20; i++) {
        const bots = await this.store.listExpiredDemoBots(now, 50);
        if (!bots.length) break;
        for (const b of bots) {
          await this.store.deleteChatbotCascade(b.id);
          this.retriever.invalidate(b.id);
          expiredDemos++;
        }
      }
      let after: string | undefined;
      for (let i = 0; i < 1000; i++) {
        const users = await this.store.listUsers(200, after);
        if (!users.length) break;
        for (const u of users) {
          const plan = await this.plans.get(u.planId);
          const cutoff = new Date(Date.now() - plan.limits.retentionDays * 86_400_000).toISOString();
          for (let j = 0; j < 50; j++) {
            const old = await this.store.listConversationsBefore(u.uid, cutoff, 200);
            if (!old.length) break;
            for (const c of old) await this.store.deleteConversationCascade(c.id);
            conversationsDeleted += old.length;
            if (old.length < 200) break;
          }
        }
        after = users[users.length - 1].uid;
        if (users.length < 200) break;
      }
      if (expiredDemos || conversationsDeleted) this.logger.info({ expiredDemos, conversationsDeleted }, 'cleanup finished');
    } finally {
      this.running = false;
    }
    return { expiredDemos, conversationsDeleted };
  }

  start(intervalMs: number): void {
    if (!intervalMs || this.timer) return;
    this.timer = setInterval(() => {
      this.run().catch((e) => this.logger.error({ err: (e as Error).message }, 'cleanup failed'));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
