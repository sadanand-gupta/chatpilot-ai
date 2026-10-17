import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_PLANS, type DashboardStats } from '@chatpilot/shared';
import { DashboardPage } from './DashboardPage';
import { jsonResponse, mockFetch, renderApp, signInDev } from '@/test/utils';

function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  const plan = DEFAULT_PLANS[1];
  return {
    chatbots: { total: 3, published: 2, draft: 1 },
    conversations: { count: 1234, days: 30, series: [{ date: '2026-10-16', count: 4 }, { date: '2026-10-17', count: 9 }] },
    leads: { count: 57, days: 30 },
    usage: {
      ownerId: 'u1',
      period: '2026-10',
      messages: 420,
      crawls: 3,
      pagesCrawled: 80,
      leads: 57,
      aiTokens: 0,
      failedRequests: 0,
      resetAt: '2026-11-01T00:00:00.000Z',
    },
    plan,
    recentActivity: [
      { type: 'lead', chatbotId: 'b1', chatbotName: 'Acme Bot', message: 'New lead: jane@acme.example', at: new Date().toISOString() },
    ],
    ...overrides,
  };
}

describe('DashboardPage', () => {
  it('renders stats from the API', async () => {
    signInDev();
    const spy = mockFetch((url) => {
      if (url.pathname === '/api/dashboard/stats') return jsonResponse(stats({ conversations: { ...stats().conversations, days: Number(url.searchParams.get('days')) } }));
      if (url.pathname === '/api/chatbots') return jsonResponse({ items: [], nextCursor: null });
      return undefined;
    });
    renderApp(<DashboardPage />, { route: '/app', path: '/app' });

    expect(await screen.findByTestId('stat-Chatbots')).toHaveTextContent('3');
    expect(screen.getByTestId('stat-Conversations')).toHaveTextContent('1,234');
    expect(screen.getByTestId('stat-Leads')).toHaveTextContent('57');
    expect(screen.getByTestId('stat-Messages this month')).toHaveTextContent('420');
    expect(screen.getByText('2 published')).toBeInTheDocument();
    expect(screen.getByText('New lead: jane@acme.example')).toBeInTheDocument();
    // usage progress bars
    expect(screen.getByRole('progressbar', { name: 'Messages usage' })).toHaveAttribute('aria-valuenow', '42');

    // default range 30 days; switching re-queries with days=7
    const statsCalls = () => spy.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/dashboard/stats'));
    expect(statsCalls()[0]).toContain('days=30');
    await userEvent.click(within(screen.getByRole('group', { name: 'Time range' })).getByRole('button', { name: '7 days' }));
    expect(await screen.findByText('In the last 7 days', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(statsCalls().some((u) => u.includes('days=7'))).toBe(true);
  });

  it('shows the first-chatbot empty state for new users', async () => {
    signInDev();
    mockFetch((url) => {
      if (url.pathname === '/api/dashboard/stats')
        return jsonResponse(stats({ chatbots: { total: 0, published: 0, draft: 0 }, recentActivity: [] }));
      if (url.pathname === '/api/chatbots') return jsonResponse({ items: [], nextCursor: null });
      return undefined;
    });
    renderApp(<DashboardPage />, { route: '/app', path: '/app' });
    const cta = await screen.findByRole('link', { name: /create your first chatbot/i });
    expect(cta).toHaveAttribute('href', '/app/chatbots/new');
  });

  it('shows an error state with retry', async () => {
    signInDev();
    mockFetch(() => jsonResponse({ error: { code: 'internal', message: 'Database unavailable' } }, 500));
    renderApp(<DashboardPage />, { route: '/app', path: '/app' });
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
