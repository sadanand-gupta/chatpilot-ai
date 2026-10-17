import type { ChatbotConfig, PublicChatbotConfig } from '@chatpilot/shared';
import { vi } from 'vitest';
import { normalizeConfig } from '../src/config';
import type { ChatPilotRuntime } from '../src/index';
import type { Widget } from '../src/widget';

export const API = 'https://api.example.com';

export function config(over: Partial<ChatbotConfig> = {}): ChatbotConfig {
  return normalizeConfig({ botName: 'Molly', headerTitle: 'Bright Smile Dental', ...over });
}

export function publicConfig(over: Partial<ChatbotConfig> = {}, mode: 'published' | 'draft' = 'published'): PublicChatbotConfig {
  return { publicId: 'cb_test', businessName: 'Bright Smile Dental', version: 3, mode, config: config(over) };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export const apiError = (status: number, code: string, message = code, details?: unknown) =>
  json(status, { error: { code, message, details } });

export interface Call {
  url: string;
  method: string;
  body: any;
}

/**
 * Routes fetch() calls by path suffix. Handlers may return a Response, or throw to simulate a network error.
 */
export function mockApi(routes: {
  config?: (call: Call) => Response | Promise<Response>;
  messages?: (call: Call, n: number) => Response | Promise<Response>;
  leads?: (call: Call) => Response | Promise<Response>;
}) {
  const calls: Call[] = [];
  let msgN = 0;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = { url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (/\/config(\?|$)/.test(url)) return routes.config ? routes.config(call) : json(200, publicConfig());
    if (/\/messages$/.test(url)) {
      msgN++;
      if (!routes.messages) throw new Error('no messages route');
      return routes.messages(call, msgN);
    }
    if (/\/leads$/.test(url)) return routes.leads ? routes.leads(call) : json(200, { ok: true, leadId: 'lead_1' });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls, posts: (suffix: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(suffix)) };
}

export const reply = (content: string, extra: Record<string, unknown> = {}, msg: Record<string, unknown> = {}) =>
  json(200, {
    conversationId: 'conv_1',
    conversationToken: 'tok_1',
    message: {
      id: 'm_' + Math.random().toString(36).slice(2),
      conversationId: 'conv_1',
      role: 'assistant',
      content,
      createdAt: '2026-10-17T10:00:00.000Z',
      ...msg,
    },
    ...extra,
  });

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Wait until `fn` returns truthy (polls the macrotask queue). */
export async function until<T>(fn: () => T, timeout = 1000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('until(): timed out');
    await tick(5);
  }
}

export const runtime = (): ChatPilotRuntime => window.ChatPilot as ChatPilotRuntime;

export function shadowOf(host?: Element | null): ShadowRoot {
  const h = host || document.querySelector('chatpilot-widget');
  if (!h || !h.shadowRoot) throw new Error('widget host not found');
  return h.shadowRoot;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = shadowOf()) => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = shadowOf()) =>
  Array.from(root.querySelectorAll<T>(sel));

export async function mountFloating(extra: Record<string, unknown> = {}): Promise<Widget> {
  const w = runtime().mount({ apiUrl: API, publicId: 'cb_test', retryBaseMs: 1, ...extra }) as Widget;
  await w.ready;
  return w;
}

/** Types into the composer and presses Enter. */
export function typeAndSend(text: string, root: ShadowRoot = shadowOf()) {
  const input = root.querySelector('textarea.input') as HTMLTextAreaElement;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

export const botBubbles = (root: ShadowRoot = shadowOf()) =>
  $$('.msg.bot:not(.err) .bubble:not(.typing)', root).map((b) => b.textContent || '');
export const userBubbles = (root: ShadowRoot = shadowOf()) => $$('.msg.user .bubble', root).map((b) => b.textContent || '');
