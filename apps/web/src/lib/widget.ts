import { useEffect, useRef, useState, type DependencyList, type RefObject } from 'react';
import type { ChatbotConfig, ChatPilotGlobal, WidgetInstance, WidgetMountOptions } from '@chatpilot/shared';
import { appConfig } from './config';

/**
 * Loader + React bindings for the vanilla ChatPilot widget runtime (apps/widget).
 * The dashboard never re-implements the widget UI: Preview Studio, the landing demo
 * and the hosted chat page all mount the real widget.js through `window.ChatPilot.mount()`.
 */

const LOAD_TIMEOUT_MS = 15_000;

type WindowWithWidget = Window & { ChatPilot?: ChatPilotGlobal };

function getGlobal(): ChatPilotGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  const g = (window as WindowWithWidget).ChatPilot;
  return g && typeof g.mount === 'function' ? g : undefined;
}

function configKey(config: ChatbotConfig | undefined): string {
  return config ? JSON.stringify(config) : '';
}

let loadPromise: Promise<ChatPilotGlobal> | null = null;

export class WidgetLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WidgetLoadError';
  }
}

/**
 * Injects widget.js once (cached promise) and resolves with `window.ChatPilot`.
 * Rejects after 15s with a clear error; a failed load can be retried by calling again.
 */
export function loadWidget(src: string = appConfig.widgetUrl, timeoutMs: number = LOAD_TIMEOUT_MS): Promise<ChatPilotGlobal> {
  const existing = getGlobal();
  if (existing) return Promise.resolve(existing);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<ChatPilotGlobal>((resolve, reject) => {
    let settled = false;
    let script = document.querySelector<HTMLScriptElement>('script[data-chatpilot-loader]');
    const created = !script;
    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = true;
      // Marks this as a programmatic load so widget.js does not auto-mount a launcher.
      script.setAttribute('data-chatpilot-loader', 'true');
      script.setAttribute('data-chatpilot-manual', 'true');
    }

    const cleanup = () => {
      window.clearTimeout(timer);
      script?.removeEventListener('load', onLoad);
      script?.removeEventListener('error', onError);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      script?.remove();
      loadPromise = null;
      reject(new WidgetLoadError(message));
    };
    const onLoad = () => {
      const g = getGlobal();
      if (g) {
        settled = true;
        cleanup();
        resolve(g);
      } else {
        fail(`The chat widget script loaded from ${src} but did not expose window.ChatPilot.`);
      }
    };
    const onError = () =>
      fail(`Couldn't load the chat widget from ${src}. Check that the API server is running and the URL is reachable.`);
    const timer = window.setTimeout(
      () => fail(`Timed out after ${Math.round(timeoutMs / 1000)}s loading the chat widget from ${src}.`),
      timeoutMs,
    );

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (created) document.head.appendChild(script);
  });
  return loadPromise;
}

/** Test helper: forget the cached loader promise. */
export function __resetWidgetLoaderForTests() {
  loadPromise = null;
}

export type UseWidgetMountOptions = Omit<WidgetMountOptions, 'container' | 'apiUrl'> & { apiUrl?: string };

export interface WidgetMountState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: Error | null;
  instance: WidgetInstance | null;
}

/**
 * Mounts the widget into `ref.current`.
 * - Remounts only when `deps` change (e.g. device, mode, publicId).
 * - Config changes call `instance.update(config)` instead of remounting.
 * - Safe under StrictMode double effects: a mount resolved after cleanup is discarded,
 *   and every mounted instance is destroyed exactly once.
 * - `sendPreview` always calls the latest function passed in (no stale closures).
 * Pass `opts = null` to keep the widget unmounted.
 */
export function useWidgetMount(
  ref: RefObject<HTMLElement | null>,
  opts: UseWidgetMountOptions | null,
  deps: DependencyList = [],
): WidgetMountState {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const instanceRef = useRef<WidgetInstance | null>(null);
  /** JSON of the config last rendered by the widget — avoids redundant update() calls. */
  const lastConfigRef = useRef<string>('');
  const [state, setState] = useState<WidgetMountState>({ status: 'idle', error: null, instance: null });
  const enabled = opts !== null;

  useEffect(() => {
    const container = ref.current;
    const initial = optsRef.current;
    if (!enabled || !container || !initial) {
      setState({ status: 'idle', error: null, instance: null });
      return;
    }
    let cancelled = false;
    let mounted: WidgetInstance | null = null;
    setState({ status: 'loading', error: null, instance: null });

    loadWidget()
      .then((cp) => {
        if (cancelled) return;
        const { sendPreview, apiUrl, ...rest } = initial;
        const mountOpts: WidgetMountOptions = {
          ...rest,
          apiUrl: apiUrl ?? appConfig.apiUrl,
          container,
          sendPreview: sendPreview
            ? (message, history) => {
                const fn = optsRef.current?.sendPreview ?? sendPreview;
                return fn(message, history);
              }
            : undefined,
        };
        mounted = cp.mount(mountOpts);
        instanceRef.current = mounted;
        lastConfigRef.current = configKey(initial.config);
        // Apply any config change that happened while the script was loading.
        const latest = optsRef.current?.config;
        if (latest && configKey(latest) !== lastConfigRef.current) {
          mounted.update(latest);
          lastConfigRef.current = configKey(latest);
        }
        setState({ status: 'ready', error: null, instance: mounted });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', error: e instanceof Error ? e : new Error(String(e)), instance: null });
      });

    return () => {
      cancelled = true;
      if (mounted) {
        try {
          mounted.destroy();
        } catch {
          /* widget already torn down */
        }
      }
      if (instanceRef.current === mounted) instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const key = configKey(opts?.config);
  useEffect(() => {
    const inst = instanceRef.current;
    const config = optsRef.current?.config;
    if (!inst || !config || key === lastConfigRef.current) return;
    lastConfigRef.current = key;
    inst.update(config);
  }, [key]);

  return state;
}

/** Debounces a fast-changing value (e.g. live form state -> widget preview). */
export function useDebouncedValue<T>(value: T, delayMs = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
