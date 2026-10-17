import type { SourceRef } from '@chatpilot/shared';

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  fallback?: boolean;
  /** Follow-up questions offered after this reply (only the latest reply's are shown). */
  suggestions?: string[];
  createdAt: string;
}

/** Everything the widget persists per chatbot (key `chatpilot:<publicId>`). Open state is never persisted. */
export interface PersistedState {
  visitorId?: string;
  conversationId?: string;
  conversationToken?: string;
  messages?: StoredMessage[];
  leadSubmitted?: boolean;
  /** Visitor has opened the chat at least once (no unread dot / teaser afterwards). */
  opened?: boolean;
  teaserShown?: boolean;
}

export const MAX_STORED_MESSAGES = 50;
const MAX_STORED_CHARS = 4000;

let cachedLs: Storage | null | undefined;

/** localStorage if usable (it throws in some sandboxed iframes / privacy modes), else null. */
function getLocalStorage(): Storage | null {
  if (cachedLs !== undefined) return cachedLs;
  try {
    const s = window.localStorage;
    const k = '__chatpilot_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    cachedLs = s;
  } catch {
    cachedLs = null;
  }
  return cachedLs;
}

/** Shared in-memory fallback (per page) when localStorage is unavailable. */
const memory = new Map<string, string>();

export class Store {
  readonly key: string;
  private readonly ls_: Storage | null;
  private mem_: Map<string, string>;

  /** `persist: false` keeps state in memory only (used by Preview Studio). */
  constructor(namespace: string, persist = true) {
    this.key = `chatpilot:${namespace}`;
    this.ls_ = persist ? getLocalStorage() : null;
    this.mem_ = persist ? memory : new Map();
  }

  read(): PersistedState {
    let raw: string | null | undefined = null;
    if (this.ls_) {
      try {
        raw = this.ls_.getItem(this.key);
      } catch {
        raw = null;
      }
    }
    if (raw == null) raw = this.mem_.get(this.key);
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object') return {};
      if (!Array.isArray(v.messages)) delete v.messages;
      return v as PersistedState;
    } catch {
      return {};
    }
  }

  write(state: PersistedState): void {
    const s: PersistedState = { ...state };
    if (s.messages) {
      s.messages = s.messages.slice(-MAX_STORED_MESSAGES).map((m) =>
        m.content.length > MAX_STORED_CHARS ? { ...m, content: m.content.slice(0, MAX_STORED_CHARS) } : m,
      );
    }
    const raw = JSON.stringify(s);
    if (this.ls_) {
      try {
        this.ls_.setItem(this.key, raw);
        this.mem_.delete(this.key);
        return;
      } catch {
        /* quota exceeded etc. — fall back to memory */
      }
    }
    this.mem_.set(this.key, raw);
  }

  patch(p: Partial<PersistedState>): PersistedState {
    const next = { ...this.read(), ...p };
    for (const k of Object.keys(next) as (keyof PersistedState)[]) if (next[k] === undefined) delete next[k];
    this.write(next);
    return next;
  }

  clear(): void {
    this.mem_.delete(this.key);
    if (this.ls_) {
      try {
        this.ls_.removeItem(this.key);
      } catch {
        /* ignore */
      }
    }
  }
}

/** RFC4122 v4 id: crypto.randomUUID → getRandomValues → Math.random. */
export function uuid(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  try {
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* insecure context */
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hx = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}`;
}
