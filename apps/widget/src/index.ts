import type { ChatPilotGlobal, WidgetInstance } from '@chatpilot/shared';
import { Widget, type MountOptions } from './widget';

export type { MountOptions } from './widget';

const LOG = '[ChatPilot]';
const PREVIEW_PARAM = 'chatpilot_preview';

interface Entry {
  key: string;
  target: Element;
  instance: Widget;
}

/** window.ChatPilot — the shared ChatPilotGlobal contract plus a few conveniences. */
export interface ChatPilotRuntime extends ChatPilotGlobal {
  mount(opts: MountOptions): WidgetInstance;
  /** Open / close / toggle the first floating widget on the page (e.g. from a "Chat with us" button). */
  open(): void;
  close(): void;
  toggle(): void;
  /** All mounted instances. */
  instances(): WidgetInstance[];
  /** @internal duplicate-init registry shared across multiple copies of widget.js on one page. */
  readonly _registry: Entry[];
  /** @internal auto-init from a <script data-chatbot-id> tag. */
  _autoInit(script: HTMLScriptElement | null): WidgetInstance | null;
}

declare global {
  interface Window {
    ChatPilot?: ChatPilotRuntime;
  }
}

const noop = () => {};
const NOOP_INSTANCE: WidgetInstance = { open: noop, close: noop, toggle: noop, update: noop, reset: noop, destroy: noop };

/** Draft preview token from ?chatpilot_preview=TOKEN, remembered for the browser session. */
function pagePreviewToken(publicId: string): string | undefined {
  const key = `chatpilot_preview:${publicId}`;
  let token: string | null = null;
  try {
    const params = new URLSearchParams(location.search);
    if (params.has(PREVIEW_PARAM)) {
      token = (params.get(PREVIEW_PARAM) || '').trim();
      try {
        if (token) sessionStorage.setItem(key, token);
        else sessionStorage.removeItem(key); // ?chatpilot_preview= (empty) exits preview mode
      } catch {
        /* storage blocked */
      }
    } else {
      try {
        token = sessionStorage.getItem(key);
      } catch {
        token = null;
      }
    }
  } catch {
    token = null;
  }
  return token && token.length <= 100 ? token : undefined;
}

export function createRuntime(): ChatPilotRuntime {
  const registry: Entry[] = [];
  const floating = () => registry.find((e) => e.instance && e.key.indexOf('|fullpage') < 0);

  const rt: ChatPilotRuntime = {
    version: __VERSION__,
    _registry: registry,

    mount(opts: MountOptions): WidgetInstance {
      try {
        if (!opts || typeof opts !== 'object') throw new Error('mount() needs an options object');
        const mode = opts.mode || 'floating';
        if (mode !== 'preview' && !opts.publicId) {
          console.warn(`${LOG} mount(): "publicId" is required for ${mode} mode.`);
          return NOOP_INSTANCE;
        }
        const target: Element | null = opts.container || document.body || document.documentElement;
        const key = `${opts.publicId || '__preview__'}|${opts.layout || (mode === 'fullpage' ? 'fullpage' : 'floating')}`;
        const dup = registry.find((e) => e.key === key && e.target === target);
        if (dup) {
          console.warn(
            `${LOG} A widget for "${opts.publicId || 'preview'}" is already mounted here — ignoring the duplicate. Call destroy() on the existing instance first to re-mount.`,
          );
          return dup.instance;
        }
        const entry = { key, target } as Entry;
        // Register before constructing so a synchronous self-destroy can unregister cleanly.
        registry.push(entry);
        const unregister = () => {
          const i = registry.indexOf(entry);
          if (i >= 0) registry.splice(i, 1);
        };
        let instance: Widget;
        try {
          instance = new Widget({ ...opts, apiUrl: (opts.apiUrl || __DEFAULT_API_URL__).trim() }, unregister);
        } catch (e) {
          unregister();
          throw e;
        }
        entry.instance = instance;
        return instance;
      } catch (e) {
        console.warn(`${LOG} mount() failed.`, e);
        return NOOP_INSTANCE;
      }
    },

    open: () => floating()?.instance.open(),
    close: () => floating()?.instance.close(),
    toggle: () => floating()?.instance.toggle(),
    instances: () => registry.map((e) => e.instance),

    _autoInit(script: HTMLScriptElement | null): WidgetInstance | null {
      if (!script || script.hasAttribute('data-chatpilot-manual')) return null;
      script.setAttribute('data-chatpilot-seen', '');
      const d = script.dataset;
      const publicId = (d.chatbotId || '').trim();
      if (!publicId) return null;
      const position = d.position === 'left' || d.position === 'right' ? d.position : undefined;
      return rt.mount({
        apiUrl: (d.apiUrl || '').trim() || __DEFAULT_API_URL__,
        publicId,
        mode: 'floating',
        channel: 'widget',
        previewToken: (d.previewToken || '').trim() || pagePreviewToken(publicId),
        position,
        open: d.open === 'true',
      });
    },
  };
  return rt;
}

function findScript(): HTMLScriptElement | null {
  const cur = document.currentScript;
  // A loader tag (data-chatpilot-manual / no data-chatbot-id) means: only ChatPilot.mount() is used.
  if (cur && cur.tagName === 'SCRIPT') return cur as HTMLScriptElement;
  // currentScript is null in some loaders (e.g. tag managers): fall back to the first unseen embed tag.
  const all = document.querySelectorAll<HTMLScriptElement>('script[data-chatbot-id]:not([data-chatpilot-manual])');
  for (let i = 0; i < all.length; i++) if (!all[i].hasAttribute('data-chatpilot-seen')) return all[i];
  return null;
}

function whenReady(fn: () => void) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

/** Installs window.ChatPilot (reusing one installed by another copy of widget.js) and auto-inits. Never throws. */
export function boot(): ChatPilotRuntime | null {
  try {
    const existing = window.ChatPilot;
    const rt =
      existing && Array.isArray(existing._registry) && typeof existing._autoInit === 'function' ? existing : createRuntime();
    if (rt !== existing) window.ChatPilot = rt;
    const script = findScript();
    if (script && script.dataset.chatbotId && !script.hasAttribute('data-chatpilot-manual')) {
      whenReady(() => {
        try {
          rt._autoInit(script);
        } catch (e) {
          console.warn(`${LOG} Auto-init failed.`, e);
        }
      });
    }
    return rt;
  } catch (e) {
    try {
      console.warn(`${LOG} Failed to load the widget.`, e);
    } catch {
      /* ignore */
    }
    return null;
  }
}

boot();
