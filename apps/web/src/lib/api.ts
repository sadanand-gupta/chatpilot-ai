import type { ApiErrorCode, QuotaErrorDetails } from '@chatpilot/shared';
import { appConfig } from './config';

export type ClientErrorCode = ApiErrorCode | 'network_error';

export class ApiError extends Error {
  status: number;
  code: ClientErrorCode;
  details?: unknown;

  constructor(opts: { status: number; code: ClientErrorCode; message: string; details?: unknown }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function isQuotaError(e: unknown): e is ApiError & { details: QuotaErrorDetails } {
  return e instanceof ApiError && e.code === 'quota_exceeded';
}

/** Human-friendly message for any thrown value. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) {
    if (e.code === 'network_error') return 'Could not reach the server. Check your connection and try again.';
    return e.message || fallback;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/* ---------------- auth token wiring (registered by AuthProvider) ---------------- */

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthTokenGetter(fn: TokenGetter | null) {
  tokenGetter = fn;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

/* ---------------- core request ---------------- */

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function buildUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${appConfig.apiUrl}/api${p}`;
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

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const err = (body as { error?: { code?: ApiErrorCode; message?: string; details?: unknown } } | null)?.error;
  return new ApiError({
    status: res.status,
    code: err?.code ?? STATUS_CODES[res.status] ?? 'internal',
    message: err?.message ?? (res.statusText || `Request failed (${res.status})`),
    details: err?.details,
  });
}

async function rawRequest(method: Method, path: string, body: unknown, opts: RequestOptions, withAuth: boolean): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withAuth && tokenGetter) {
    const token = await tokenGetter().catch(() => null);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 0, code: 'network_error', message: 'Network error — could not reach the server.' });
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (withAuth && err.status === 401) unauthorizedHandler?.();
    throw err;
  }
  return res;
}

async function request<T>(method: Method, path: string, body: unknown, opts: RequestOptions, withAuth: boolean): Promise<T> {
  const res = await rawRequest(method, path, body, opts, withAuth);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function makeClient(withAuth: boolean) {
  return {
    get: <T>(path: string, opts: RequestOptions = {}) => request<T>('GET', path, undefined, opts, withAuth),
    post: <T>(path: string, body?: unknown, opts: RequestOptions = {}) => request<T>('POST', path, body, opts, withAuth),
    put: <T>(path: string, body?: unknown, opts: RequestOptions = {}) => request<T>('PUT', path, body, opts, withAuth),
    patch: <T>(path: string, body?: unknown, opts: RequestOptions = {}) => request<T>('PATCH', path, body, opts, withAuth),
    del: <T>(path: string, opts: RequestOptions = {}) => request<T>('DELETE', path, undefined, opts, withAuth),
    /** Fetches a file (e.g. CSV) and triggers a browser download. */
    download: async (path: string, filename: string, opts: RequestOptions = {}): Promise<void> => {
      const res = await rawRequest('GET', path, undefined, { ...opts, headers: { Accept: '*/*', ...opts.headers } }, withAuth);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    },
  };
}

export type ApiClient = ReturnType<typeof makeClient>;

/** Authenticated client — attaches the signed-in user's bearer token. */
export const api: ApiClient = makeClient(true);
/** Public client — never sends credentials. */
export const publicApi: ApiClient = makeClient(false);

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
