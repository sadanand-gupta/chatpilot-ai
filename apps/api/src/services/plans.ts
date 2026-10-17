import { DEFAULT_PLANS, findPlan, type Plan } from '@chatpilot/shared';
import type { Store } from '../data/store';
import type { Logger } from '../lib/logger';

/**
 * Plan catalogue: DEFAULT_PLANS, overridden by PLANS_JSON (env) and then by
 * documents in the Firestore `plans` collection (cached for 60 s).
 */
export class PlanService {
  private cache: { at: number; plans: Plan[] } | null = null;

  constructor(
    private readonly store: Store,
    private readonly envPlans: Plan[] | undefined,
    private readonly logger: Logger,
  ) {}

  async list(): Promise<Plan[]> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.plans;
    const base = this.envPlans ?? DEFAULT_PLANS;
    let docs: Partial<Plan>[] = [];
    try {
      docs = await this.store.listPlanDocs();
    } catch (e) {
      this.logger.warn({ err: (e as Error).message }, 'could not load plan overrides');
    }
    const plans = base.map((p) => {
      const o = docs.find((d) => d.id === p.id);
      if (!o) return p;
      return { ...p, ...o, limits: { ...p.limits, ...(o.limits ?? {}) }, features: { ...p.features, ...(o.features ?? {}) } } as Plan;
    });
    this.cache = { at: Date.now(), plans };
    return plans;
  }

  async get(planId: string | undefined): Promise<Plan> {
    return findPlan(await this.list(), planId);
  }
}
