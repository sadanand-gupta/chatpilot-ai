import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, isQuotaError, publicApi, qs, setAuthTokenGetter } from './api';
import { shouldRetry } from './queryClient';
import { jsonResponse } from '@/test/utils';

function lastCall(spy: { mock: { calls: unknown[][] } }) {
  const [url, init] = spy.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

describe('api client', () => {
  afterEach(() => setAuthTokenGetter(null));

  it('prefixes /api and attaches the bearer token from the auth layer', async () => {
    setAuthTokenGetter(async () => 'tok_abc');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    const res = await api.get<{ items: unknown[] }>('/chatbots');
    expect(res.items).toEqual([]);
    const { url, init, headers } = lastCall(spy);
    expect(url).toMatch(/\/api\/chatbots$/);
    expect(init.method).toBe('GET');
    expect(headers.Authorization).toBe('Bearer tok_abc');
  });

  it('sends JSON bodies for POST/PATCH', async () => {
    setAuthTokenGetter(async () => 'tok');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    await api.patch('/me', { displayName: 'A' });
    const { init, headers } = lastCall(spy);
    expect(init.method).toBe('PATCH');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ displayName: 'A' }));
  });

  it('omits Authorization when signed out', async () => {
    setAuthTokenGetter(async () => null);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
    await api.get('/me');
    expect(lastCall(spy).headers.Authorization).toBeUndefined();
  });

  it('publicApi never sends credentials even when signed in', async () => {
    setAuthTokenGetter(async () => 'tok_secret');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ items: [] }));
    await publicApi.get('/public/plans');
    expect(lastCall(spy).headers.Authorization).toBeUndefined();
  });

  it('maps error bodies to ApiError with status, code and details', async () => {
    const details = { metric: 'messages', used: 100, limit: 100, resetAt: '2026-11-01T00:00:00.000Z', planId: 'free' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { code: 'quota_exceeded', message: 'Monthly message limit reached', details } }, 402),
    );
    const err = (await api.post('/chatbots/x/preview/messages', { message: 'hi' }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(402);
    expect(err.code).toBe('quota_exceeded');
    expect(err.message).toBe('Monthly message limit reached');
    expect(err.details).toEqual(details);
    expect(isQuotaError(err)).toBe(true);
  });

  it('falls back to a status-derived code when the body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 404 }));
    const err = (await api.get('/chatbots/missing').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('not_found');
    expect(isQuotaError(err)).toBe(false);
  });

  it('wraps fetch failures as network_error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await api.get('/me').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('network_error');
    expect(err.status).toBe(0);
  });

  it('builds query strings skipping empty values', () => {
    expect(qs({ chatbotId: 'a b', q: '', cursor: undefined, limit: 25 })).toBe('?chatbotId=a+b&limit=25');
    expect(qs({})).toBe('');
  });

  it('query retry policy never retries 4xx', () => {
    expect(shouldRetry(0, new ApiError({ status: 404, code: 'not_found', message: '' }))).toBe(false);
    expect(shouldRetry(0, new ApiError({ status: 503, code: 'internal', message: '' }))).toBe(true);
    expect(shouldRetry(2, new ApiError({ status: 0, code: 'network_error', message: '' }))).toBe(false);
  });
});
