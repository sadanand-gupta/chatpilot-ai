import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { AuthProvider, DEV_AUTH_STORAGE_KEY } from '@/lib/auth';
import { TooltipProvider } from '@/components/ui/tooltip';

export function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

export function signInDev(email = 'owner@example.com', token = 'dev-token-123') {
  localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify({ token, uid: 'u1', email, displayName: 'Owner Person' }));
}

export function renderApp(
  ui: ReactElement,
  opts: { route?: string; path?: string; extraRoutes?: { path: string; element: ReactElement }[] } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider mode="dev">
        <TooltipProvider>
          <MemoryRouter initialEntries={[opts.route ?? '/']}>
            <Routes>
              <Route path={opts.path ?? '*'} element={children} />
              {opts.extraRoutes?.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper }) };
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

/** Mocks global fetch; each handler may return a Response or undefined to fall through. Unmatched -> 404 JSON. */
export function mockFetch(...handlers: Handler[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    for (const h of handlers) {
      const res = await h(url, init);
      if (res) return res;
    }
    return jsonResponse({ error: { code: 'not_found', message: `No mock for ${url.pathname}` } }, 404);
  });
}
