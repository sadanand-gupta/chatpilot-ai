import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { apiWarmer, createApiWarmer, useApiWaking, useKeepApiWarm } from './keepWarm';

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
});

const okFetch = () => vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}'));

describe('createApiWarmer', () => {
  it('GETs /health without credentials and dedupes pings within the gap', async () => {
    const fetchImpl = okFetch();
    const w = createApiWarmer({ apiUrl: 'https://api.example.com/', enabled: true, fetchImpl, minGapMs: 1000 });
    await w.ping();
    await w.ping();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/health');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store' });
    await w.ping({ force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('swallows network errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const w = createApiWarmer({ apiUrl: 'https://api.example.com', enabled: true, fetchImpl });
    await expect(w.ping()).resolves.toBeUndefined();
  });

  it('does nothing when disabled (unit tests, local API)', async () => {
    const fetchImpl = okFetch();
    const w = createApiWarmer({ apiUrl: 'https://api.example.com', enabled: false, fetchImpl });
    await w.ping({ force: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(apiWarmer.enabled).toBe(false);
  });

  it('reports "waking" while a ping is slower than slowMs', async () => {
    let resolve!: (r: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const w = createApiWarmer({ apiUrl: 'https://api.example.com', enabled: true, fetchImpl, slowMs: 3000 });
    const { result } = renderHook(() => useApiWaking(w));
    const pending = w.ping();
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(3001));
    expect(result.current).toBe(true);
    await act(async () => {
      resolve(new Response('{}'));
      await pending;
    });
    expect(result.current).toBe(false);
  });
});

describe('useKeepApiWarm', () => {
  it('pings on mount and on an interval only while the tab is visible', async () => {
    const fetchImpl = okFetch();
    const w = createApiWarmer({ apiUrl: 'https://api.example.com', enabled: true, fetchImpl, minGapMs: 0 });
    const { unmount } = renderHook(() => useKeepApiWarm(w, 60_000));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    act(() => setVisibility('hidden'));
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Pings right away when the tab comes back, then resumes the interval.
    act(() => setVisibility('visible'));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    // Unmount (sign-out) stops pinging.
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not ping when mounted in a hidden tab', async () => {
    visibility = 'hidden';
    const fetchImpl = okFetch();
    const w = createApiWarmer({ apiUrl: 'https://api.example.com', enabled: true, fetchImpl, minGapMs: 0 });
    renderHook(() => useKeepApiWarm(w, 60_000));
    await act(async () => vi.advanceTimersByTimeAsync(3 * 60_000));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
