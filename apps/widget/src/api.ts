import type {
  ApiErrorCode,
  ChatMessageInput,
  LeadInput,
  PublicChatbotConfig,
  PublicChatReply,
} from '@chatpilot/shared';

/** API error codes plus client-side failure modes. */
export type ClientErrorCode = ApiErrorCode | 'network_error' | 'timeout' | 'aborted';

export class ChatPilotApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Seconds from the Retry-After header (rate_limited), if any. */
  readonly retryAfter?: number;

  constructor(code: ClientErrorCode, message: string, status = 0, details?: unknown, retryAfter?: number) {
    super(message);
    this.name = 'ChatPilotApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

export interface ApiClientOptions {
  /** Base delay for exponential backoff (ms). */
  retryBaseMs?: number;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
  /** Extra attempts on network errors / 5xx (never on 4xx). */
  retries: number;
  /** Also retry after a timeout (only safe for idempotent requests). */
  retryOnTimeout?: boolean;
  signal?: AbortSignal;
}

export interface ApiClient {
  getConfig(publicId: string, previewToken?: string, signal?: AbortSignal): Promise<PublicChatbotConfig>;
  sendMessage(publicId: string, body: ChatMessageInput, signal?: AbortSignal): Promise<PublicChatReply>;
  submitLead(publicId: string, body: LeadInput, signal?: AbortSignal): Promise<{ ok: true; leadId: string }>;
}

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'validation_error',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
};

async function toError(res: Response): Promise<ChatPilotApiError> {
  let body: { error?: { code?: ApiErrorCode; message?: string; details?: unknown } } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const e = body && typeof body === 'object' ? body.error : undefined;
  const code: ApiErrorCode = (e && e.code) || STATUS_CODES[res.status] || 'internal';
  const ra = Number(res.headers && res.headers.get('Retry-After'));
  return new ChatPilotApiError(
    code,
    (e && e.message) || `Request failed (${res.status})`,
    res.status,
    e && e.details,
    Number.isFinite(ra) && ra > 0 ? ra : undefined,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(done, ms);
    function done() {
      signal && signal.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(t);
      reject(new ChatPilotApiError('aborted', 'Request aborted'));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function isRetryable(err: ChatPilotApiError, retryOnTimeout = false): boolean {
  return err.code === 'network_error' || (retryOnTimeout && err.code === 'timeout') || err.status >= 500;
}

export function createApiClient(apiUrl: string, options: ApiClientOptions = {}): ApiClient {
  const base = apiUrl.replace(/\/+$/, '') + '/api/public/chatbots/';
  const backoff = options.retryBaseMs ?? 600;

  async function request<T>(path: string, o: RequestOptions): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (o.signal && o.signal.aborted) throw new ChatPilotApiError('aborted', 'Request aborted');
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl && ctrl.abort();
      }, o.timeoutMs);
      const onAbort = () => ctrl && ctrl.abort();
      if (o.signal) o.signal.addEventListener('abort', onAbort, { once: true });

      let err: ChatPilotApiError;
      try {
        const init: RequestInit = {
          method: o.method,
          credentials: 'omit',
          mode: 'cors',
          signal: ctrl ? ctrl.signal : undefined,
        };
        if (o.body !== undefined) {
          init.headers = { 'Content-Type': 'application/json' };
          init.body = JSON.stringify(o.body);
        }
        const res = await fetch(base + path, init);
        if (res.ok) {
          let data: unknown;
          try {
            data = await res.json();
          } catch {
            data = undefined;
          }
          if (data === undefined || data === null) {
            throw new ChatPilotApiError('internal', 'Invalid response from server', res.status);
          }
          return data as T;
        }
        err = await toError(res);
      } catch (e) {
        if (e instanceof ChatPilotApiError) err = e;
        else if (o.signal && o.signal.aborted) err = new ChatPilotApiError('aborted', 'Request aborted');
        else if (timedOut) err = new ChatPilotApiError('timeout', 'The request timed out');
        else err = new ChatPilotApiError('network_error', 'Network error — check your connection');
      } finally {
        clearTimeout(timer);
        if (o.signal) o.signal.removeEventListener('abort', onAbort);
      }

      if (err.code === 'aborted' || attempt >= o.retries || !isRetryable(err, o.retryOnTimeout)) throw err;
      await sleep(backoff * Math.pow(2, attempt) + Math.random() * backoff * 0.5, o.signal);
    }
  }

  const enc = encodeURIComponent;
  return {
    getConfig(publicId, previewToken, signal) {
      const q = previewToken ? `?previewToken=${enc(previewToken)}` : '';
      return request<PublicChatbotConfig>(`${enc(publicId)}/config${q}`, {
        method: 'GET',
        timeoutMs: 15000,
        retries: 2,
        retryOnTimeout: true,
        signal,
      });
    },
    sendMessage(publicId, body, signal) {
      // Not retried after a timeout: the server may already be generating a reply.
      return request<PublicChatReply>(`${enc(publicId)}/messages`, {
        method: 'POST',
        body,
        timeoutMs: 30000,
        retries: 1,
        signal,
      });
    },
    submitLead(publicId, body, signal) {
      return request<{ ok: true; leadId: string }>(`${enc(publicId)}/leads`, {
        method: 'POST',
        body,
        timeoutMs: 20000,
        retries: 1,
        signal,
      });
    },
  };
}
