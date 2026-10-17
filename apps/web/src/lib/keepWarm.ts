import { useEffect, useSyncExternalStore } from 'react';
import { appConfig } from './config';

/**
 * Keeps the API warm while people use the site. The API runs on Render's free plan, which sleeps
 * after ~15 min idle and takes 30–60 s to wake. We ping the unauthenticated, CORS-open `/health`
 * endpoint (no rate limit) as soon as any page loads, and every few minutes while a signed-in user
 * has the app open in a visible tab. Fire-and-forget: failures are ignored, never toasted.
 *
 * This only covers active use. Staying awake 24/7 needs an external pinger (e.g. UptimeRobot).
 */

export const KEEP_WARM_INTERVAL_MS = 4.5 * 60_000;
/** A ping slower than this is probably a cold start; auth pages show a "waking up" hint. */
export const SLOW_PING_MS = 3_000;
/** Pings closer together than this are skipped (StrictMode double effects, focus flapping). */
const MIN_GAP_MS = 30_000;
/** Render cold starts can take about a minute; give up after this. */
const PING_TIMEOUT_MS = 90_000;

export interface ApiWarmer {
  /** Pings /health unless one is in flight or one started less than MIN_GAP_MS ago (`force` skips the gap). */
  ping(opts?: { force?: boolean }): Promise<void>;
  /** True while a ping has been pending for longer than SLOW_PING_MS. */
  isWaking(): boolean;
  subscribe(listener: () => void): () => void;
  readonly enabled: boolean;
}

export function createApiWarmer(opts: {
  apiUrl: string;
  enabled: boolean;
  fetchImpl?: typeof fetch;
  slowMs?: number;
  minGapMs?: number;
}): ApiWarmer {
  const slowMs = opts.slowMs ?? SLOW_PING_MS;
  const minGapMs = opts.minGapMs ?? MIN_GAP_MS;
  const url = `${opts.apiUrl.replace(/\/+$/, '')}/health`;
  let inflight: Promise<void> | null = null;
  let lastStart = -Infinity;
  let waking = false;
  const listeners = new Set<() => void>();
  const setWaking = (v: boolean) => {
    if (waking === v) return;
    waking = v;
    listeners.forEach((l) => l());
  };

  return {
    enabled: opts.enabled,
    ping({ force = false } = {}) {
      if (!opts.enabled) return Promise.resolve();
      if (inflight) return inflight;
      if (!force && Date.now() - lastStart < minGapMs) return Promise.resolve();
      lastStart = Date.now();
      const doFetch = opts.fetchImpl ?? fetch;
      const slowTimer = setTimeout(() => setWaking(true), slowMs);
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(PING_TIMEOUT_MS) : undefined;
      inflight = doFetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit', signal })
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(slowTimer);
          inflight = null;
          setWaking(false);
        });
      return inflight;
    },
    isWaking: () => waking,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function isLocalUrl(u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  } catch {
    return true;
  }
}

/** Off in unit tests and against a local API (nothing to wake there). */
export const apiWarmer = createApiWarmer({
  apiUrl: appConfig.apiUrl,
  enabled: import.meta.env.MODE !== 'test' && !isLocalUrl(appConfig.apiUrl),
});

/** Starts waking the API on page load, while the visitor is still reading the page. */
export function warmApiOnLoad(warmer: ApiWarmer = apiWarmer): void {
  void warmer.ping({ force: true });
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * While mounted (the signed-in app shell): ping every `intervalMs` while the tab is visible, and
 * right away when it becomes visible again. Unmounting (sign-out) stops it.
 */
export function useKeepApiWarm(warmer: ApiWarmer = apiWarmer, intervalMs = KEEP_WARM_INTERVAL_MS): void {
  useEffect(() => {
    if (!warmer.enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      void warmer.ping();
      timer = setInterval(() => {
        if (isVisible()) void warmer.ping({ force: true });
      }, intervalMs);
    };
    const onVisibility = () => (isVisible() ? start() : stop());
    if (isVisible()) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [warmer, intervalMs]);
}

/** True while the API seems to be cold-starting (a ping has taken longer than SLOW_PING_MS). */
export function useApiWaking(warmer: ApiWarmer = apiWarmer): boolean {
  return useSyncExternalStore(warmer.subscribe, warmer.isWaking, () => false);
}
