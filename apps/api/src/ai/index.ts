import type { Env } from '../config/env';
import { MockProvider } from './mock';
import { OllamaProvider } from './ollama';
import { OpenAICompatibleProvider } from './openaiCompatible';
import { AIProviderError, type AIChatRequest, type AIChatResult, type AIMessage, type AIProvider } from './types';

export * from './types';
export { MockProvider } from './mock';

export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    return () => this.release();
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export function createProvider(env: Env): AIProvider {
  switch (env.AI_PROVIDER) {
    case 'mock':
      return new MockProvider();
    case 'ollama':
      return new OllamaProvider({ baseUrl: env.AI_BASE_URL, model: env.AI_MODEL! });
    case 'openai':
    default:
      return new OpenAICompatibleProvider({ baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY!, model: env.AI_MODEL!, reasoningEffort: env.AI_REASONING_EFFORT });
  }
}

export interface AIClientOptions {
  timeoutMs: number;
  maxRetries: number;
  maxConcurrency: number;
  /** Total characters across all messages; older history is dropped first, then knowledge is trimmed. */
  maxInputChars?: number;
  /** Base delay for exponential backoff (tests use a small value). */
  backoffBaseMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Clamps total input size while keeping system + the final user message intact. */
export function clampMessages(messages: AIMessage[], maxChars: number): AIMessage[] {
  const total = () => out.reduce((n, m) => n + m.content.length, 0);
  const out = messages.map((m) => ({ ...m }));
  // Drop oldest history turns (between the knowledge block and the final question).
  while (total() > maxChars) {
    const idx = out.findIndex((m, i) => i > 0 && i < out.length - 1 && !m.content.startsWith('<knowledge>') && m.role !== 'system');
    if (idx === -1) break;
    out.splice(idx, 1);
  }
  if (total() > maxChars) {
    const k = out.find((m) => m.content.startsWith('<knowledge>'));
    if (k) {
      const excess = total() - maxChars;
      k.content = k.content.slice(0, Math.max(500, k.content.length - excess - 20)) + '\n</knowledge>';
    }
  }
  const last = out[out.length - 1];
  if (last && total() > maxChars) last.content = last.content.slice(0, 4000);
  return out;
}

/** Wraps a provider with a global concurrency limit, timeout, retries with backoff + jitter and input clamping. */
export class AIClient {
  private sem: Semaphore;
  private healthCache: { at: number; ok: boolean } | null = null;

  constructor(
    public readonly provider: AIProvider,
    private readonly opts: AIClientOptions,
  ) {
    this.sem = new Semaphore(opts.maxConcurrency);
  }

  get name(): string {
    return this.provider.name;
  }

  async chat(req: Omit<AIChatRequest, 'signal'> & { signal?: AbortSignal }): Promise<AIChatResult & { latencyMs: number; attempts: number }> {
    const messages = clampMessages(req.messages, this.opts.maxInputChars ?? 24_000);
    const release = await this.sem.acquire();
    const started = Date.now();
    try {
      let attempt = 0;
      for (;;) {
        attempt++;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs);
        const onAbort = () => ac.abort();
        req.signal?.addEventListener('abort', onAbort);
        try {
          const result = await this.provider.chat({ ...req, messages, signal: ac.signal });
          return { ...result, latencyMs: Date.now() - started, attempts: attempt };
        } catch (e) {
          const err =
            e instanceof AIProviderError
              ? e
              : new AIProviderError((e as Error).message, (e as Error).name === 'AbortError', undefined);
          if (!err.retryable || attempt > this.opts.maxRetries || req.signal?.aborted) throw err;
          const base = this.opts.backoffBaseMs ?? 400;
          const delay = err.retryAfterMs ?? base * 2 ** (attempt - 1) + Math.random() * base;
          await sleep(Math.min(delay, 8000));
        } finally {
          clearTimeout(timer);
          req.signal?.removeEventListener('abort', onAbort);
        }
      }
    } finally {
      release();
    }
  }

  /** Cached for 60 s so /health stays cheap. */
  async health(): Promise<boolean> {
    if (this.healthCache && Date.now() - this.healthCache.at < 60_000) return this.healthCache.ok;
    const ok = await this.provider.health().catch(() => false);
    this.healthCache = { at: Date.now(), ok };
    return ok;
  }
}

export function createAIClient(env: Env, provider = createProvider(env)): AIClient {
  return new AIClient(provider, {
    timeoutMs: env.AI_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    maxConcurrency: env.AI_MAX_CONCURRENCY,
  });
}
