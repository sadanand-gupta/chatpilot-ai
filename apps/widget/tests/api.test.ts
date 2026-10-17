import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPilotApiError, createApiClient } from '../src/api';
import { apiError, json, publicConfig } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('builds the config URL with an encoded preview token', async () => {
    const fetchMock = vi.fn(async () => json(200, publicConfig()));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient('https://api.example.com/', { retryBaseMs: 1 });
    await api.getConfig('cb_1', 'tok/&x');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/public/chatbots/cb_1/config?previewToken=tok%2F%26x',
      expect.objectContaining({ method: 'GET', credentials: 'omit' }),
    );
  });

  it('retries network errors and 5xx with backoff, then succeeds', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      if (n === 1) throw new TypeError('Failed to fetch');
      if (n === 2) return apiError(503, 'ai_unavailable');
      return json(200, publicConfig());
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient('https://api.example.com', { retryBaseMs: 1 });
    const cfg = await api.getConfig('cb_1');
    expect(cfg.publicId).toBe('cb_test');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx and exposes code/details/retryAfter', async () => {
    const fetchMock = vi.fn(async () => apiError(429, 'rate_limited', 'Slow down', { x: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(
      json(429, { error: { code: 'rate_limited', message: 'Slow down', details: { x: 1 } } }, { 'Retry-After': '7' }),
    );
    const api = createApiClient('https://api.example.com', { retryBaseMs: 1 });
    const err = (await api
      .sendMessage('cb_1', { message: 'hi', visitorId: 'v_12345678', channel: 'widget' })
      .catch((e) => e)) as ChatPilotApiError;
    expect(err).toBeInstanceOf(ChatPilotApiError);
    expect(err.code).toBe('rate_limited');
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(7);
    expect(err.details).toEqual({ x: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps non-JSON error bodies by status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const api = createApiClient('https://api.example.com', { retryBaseMs: 1 });
    const err = (await api.getConfig('cb_x').catch((e) => e)) as ChatPilotApiError;
    expect(err.code).toBe('not_found');
  });

  it('gives up after the retry budget on persistent network failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient('https://api.example.com', { retryBaseMs: 1 });
    const err = (await api
      .sendMessage('cb_1', { message: 'hi', visitorId: 'v_12345678', channel: 'widget' })
      .catch((e) => e)) as ChatPilotApiError;
    expect(err.code).toBe('network_error');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 attempt + 1 retry for messages
  });
});
