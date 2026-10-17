import type { Plan, QuotaErrorDetails, Usage, UsageMetric } from '@chatpilot/shared';
import type { Store } from '../data/store';
import { AppError, quotaExceeded } from '../lib/errors';
import { monthPeriod, periodResetAt } from '../lib/http';

export type QuotaMetric = 'messages' | 'crawls' | 'leads';

const LIMIT_KEY: Record<QuotaMetric, keyof Plan['limits']> = {
  messages: 'messagesPerMonth',
  crawls: 'crawlsPerMonth',
  leads: 'leadsPerMonth',
};

/**
 * Per-owner monthly counters (usage/{ownerId}_{YYYY-MM}) incremented atomically.
 * Quotas are check-before-act: concurrent requests can overshoot by at most the
 * concurrency level, which is acceptable for soft monthly limits.
 */
export class UsageService {
  constructor(private readonly store: Store) {}

  period(d = new Date()): string {
    return monthPeriod(d);
  }

  async get(ownerId: string, period = this.period()): Promise<Usage> {
    const u = await this.store.getUsage(ownerId, period);
    return {
      ownerId,
      period,
      messages: u?.messages ?? 0,
      crawls: u?.crawls ?? 0,
      pagesCrawled: u?.pagesCrawled ?? 0,
      leads: u?.leads ?? 0,
      aiTokens: u?.aiTokens ?? 0,
      failedRequests: u?.failedRequests ?? 0,
      resetAt: periodResetAt(period),
    };
  }

  quotaDetails(plan: Plan, usage: Usage, metric: QuotaMetric): QuotaErrorDetails {
    return { metric, limit: plan.limits[LIMIT_KEY[metric]], used: usage[metric], resetAt: usage.resetAt, planId: plan.id };
  }

  /** Throws 402 quota_exceeded when `amount` more would exceed the plan limit. */
  async check(ownerId: string, plan: Plan, metric: QuotaMetric, amount = 1): Promise<Usage> {
    const usage = await this.get(ownerId);
    const limit = plan.limits[LIMIT_KEY[metric]];
    if (usage[metric] + amount > limit) throw quotaExceeded(this.quotaDetails(plan, usage, metric));
    return usage;
  }

  /** Non-throwing variant for public endpoints that answer with a friendly message instead. */
  async isExceeded(ownerId: string, plan: Plan, metric: QuotaMetric): Promise<boolean> {
    try {
      await this.check(ownerId, plan, metric);
      return false;
    } catch (e) {
      if (e instanceof AppError && e.code === 'quota_exceeded') return true;
      throw e;
    }
  }

  async record(ownerId: string, deltas: Partial<Record<UsageMetric, number>>): Promise<void> {
    if (!Object.values(deltas).some((v) => v)) return;
    await this.store.incrementUsage(ownerId, this.period(), deltas);
  }
}
