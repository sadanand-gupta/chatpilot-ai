import { DEFAULT_PLAN_ID, type MeResponse, type UpdateProfileInput, type UserProfile } from '@chatpilot/shared';
import type { Store } from '../data/store';
import type { Logger } from '../lib/logger';
import { nowIso } from '../lib/http';
import type { PlanService } from './plans';
import type { UsageService } from './usage';

export class UserService {
  constructor(
    private readonly store: Store,
    private readonly plans: PlanService,
    private readonly usage: UsageService,
    private readonly logger: Logger,
    /** Deletes the Firebase Auth user (firebase mode only). */
    private readonly deleteAuthUser?: (uid: string) => Promise<void>,
  ) {}

  /** Lazily creates users/{uid} on the first authenticated request. */
  async ensureUser(uid: string, email: string, displayName?: string): Promise<UserProfile> {
    const existing = await this.store.getUser(uid);
    if (existing) return { ...existing, uid };
    const now = nowIso();
    const user: UserProfile = { uid, email, displayName: displayName || undefined, planId: DEFAULT_PLAN_ID, createdAt: now, updatedAt: now };
    await this.store.createUser(user);
    this.logger.info({ uid }, 'user profile created');
    return user;
  }

  async me(user: UserProfile): Promise<MeResponse> {
    const plan = await this.plans.get(user.planId);
    const usage = await this.usage.get(user.uid);
    return { user, plan, usage };
  }

  async updateProfile(user: UserProfile, input: UpdateProfileInput): Promise<MeResponse> {
    const patch: Partial<UserProfile> = { updatedAt: nowIso() };
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.businessName !== undefined) patch.businessName = input.businessName;
    await this.store.updateUser(user.uid, patch);
    return this.me({ ...user, ...patch });
  }

  /** Deletes ALL tenant data, then the auth account. */
  async deleteAccount(uid: string): Promise<void> {
    await this.store.deleteOwnerData(uid);
    if (this.deleteAuthUser) {
      try {
        await this.deleteAuthUser(uid);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== 'auth/user-not-found') throw e;
      }
    }
    this.logger.info({ uid }, 'account deleted');
  }
}
