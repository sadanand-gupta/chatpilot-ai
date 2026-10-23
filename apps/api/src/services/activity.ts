import type { Request } from 'express';
import type { ActivityEvent, UserProfile } from '@chatpilot/shared';
import type { Store } from '../data/store';
import { increment } from '../data/docdb';
import { clientIp, nowIso } from '../lib/http';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';

/** A return after this long away counts as a new sign-in. */
export const SESSION_GAP_MS = 30 * 60_000;
/** lastActiveAt is written at most this often per user. */
export const ACTIVE_WRITE_MS = 5 * 60_000;
/** A first session this soon after the profile was created is the sign-up itself. */
const SIGN_UP_WINDOW_MS = 10 * 60_000;
const MAX_TRACKED = 10_000;

export type ActivityInput = Omit<ActivityEvent, 'id' | 'createdAt'>;

/** Who did it and from where, for events logged from an authenticated request. */
export function actorOf(req: Request): Pick<ActivityEvent, 'uid' | 'email' | 'ip' | 'userAgent'> {
  return { uid: req.user?.uid, email: req.user?.email, ip: clientIp(req), userAgent: userAgentOf(req) };
}

export function userAgentOf(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' && ua ? ua.slice(0, 300) : undefined;
}

export const demoEventId = (demoId: string) => `demo_${demoId}`;

/**
 * Platform audit log for the admin console: sign-ups, sign-ins, landing-page demos and chatbot
 * lifecycle. Logging is best-effort: a failed write is logged and never fails the request.
 */
export class ActivityService {
  /** uid -> last time this instance wrote lastActiveAt (dedupes bursts of parallel requests). */
  private lastTouch = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly logger: Logger,
  ) {}

  async log(input: ActivityInput & { id?: string }): Promise<void> {
    const event: ActivityEvent = { ...input, id: input.id ?? newId(), createdAt: nowIso() };
    try {
      await this.store.addActivity(event);
    } catch (e) {
      this.logger.warn({ err: (e as Error).message, type: event.type }, 'activity log write failed');
    }
  }

  async update(id: string, patch: Record<string, unknown>): Promise<void> {
    try {
      await this.store.updateActivity(id, patch);
    } catch (e) {
      // Missing doc (e.g. a demo created before activity logging existed) is fine.
      this.logger.debug({ err: (e as Error).message, id }, 'activity update skipped');
    }
  }

  demoMessage(demoId: string): Promise<void> {
    return this.update(demoEventId(demoId), { messages: increment(1) });
  }

  /** Called on every authenticated request: keeps lastActiveAt fresh and logs new sessions. */
  async touch(user: UserProfile, req: Request): Promise<void> {
    const now = Date.now();
    const seen = this.lastTouch.get(user.uid);
    if (seen && now - seen < ACTIVE_WRITE_MS) return;
    const lastActive = user.lastActiveAt ? Date.parse(user.lastActiveAt) : 0;
    if (now - lastActive < ACTIVE_WRITE_MS) {
      this.remember(user.uid, now);
      return;
    }
    this.remember(user.uid, now);
    const newSession = now - lastActive >= SESSION_GAP_MS;
    const at = new Date(now).toISOString();
    try {
      await this.store.touchUser(user.uid, at, newSession);
    } catch (e) {
      this.logger.warn({ err: (e as Error).message }, 'user activity update failed');
      return;
    }
    if (!newSession) return;
    const isSignUp = !user.signInCount && now - Date.parse(user.createdAt) < SIGN_UP_WINDOW_MS;
    await this.log({ type: isSignUp ? 'sign_up' : 'sign_in', ...actorOf(req), uid: user.uid, email: user.email });
  }

  private remember(uid: string, at: number): void {
    if (this.lastTouch.size >= MAX_TRACKED) this.lastTouch.clear();
    this.lastTouch.set(uid, at);
  }
}
