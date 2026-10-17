import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { defaultChatbotConfig, type Chatbot } from '@chatpilot/shared';

export function renderWithProviders(ui: ReactElement, opts: { route?: string; path?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? '/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {opts.path ? (
          <Routes>
            <Route path={opts.path} element={children} />
          </Routes>
        ) : (
          children
        )}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper }) };
}

export function makeChatbot(overrides: Partial<Chatbot> = {}): Chatbot {
  return {
    id: 'bot_1',
    ownerId: 'u1',
    publicId: 'pub_1',
    name: 'Acme',
    businessName: 'Acme Bakery',
    websiteUrl: 'https://acme.example',
    language: 'auto',
    status: 'draft',
    config: defaultChatbotConfig(),
    allowedOrigins: [],
    knowledgeVersion: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}
