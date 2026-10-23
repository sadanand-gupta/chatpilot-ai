import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { DEFAULT_PLANS, type AdminOverview, type MeResponse } from '@chatpilot/shared';
import { AdminPage } from './AdminPage';
import { jsonResponse, LocationProbe, mockFetch, renderApp, signInDev } from '@/test/utils';

function me(isAdmin: boolean): MeResponse {
  const now = new Date().toISOString();
  return {
    user: { uid: 'u1', email: isAdmin ? 'speedolive369@gmail.com' : 'owner@example.com', planId: 'free', createdAt: now, updatedAt: now },
    plan: DEFAULT_PLANS[0],
    usage: { ownerId: 'u1', period: '2026-10', messages: 0, crawls: 0, pagesCrawled: 0, leads: 0, aiTokens: 0, failedRequests: 0, resetAt: now },
    isAdmin,
  };
}

const overview: AdminOverview = {
  totals: { users: 42, newUsers7d: 5, activeUsers7d: 17, chatbots: 9, publishedChatbots: 4, conversations: 310, leads: 12, demos7d: 23 },
  daily: [{ date: '2026-10-22', signUps: 2, signIns: 6, demos: 3 }],
  recentActivity: [
    {
      id: 'e1',
      type: 'demo_started',
      url: 'https://acme-dental.example/',
      chatbotName: 'Acme Dental',
      ip: '203.0.113.7',
      status: 'ready',
      createdAt: new Date().toISOString(),
    },
    { id: 'e2', type: 'sign_in', uid: 'u9', email: 'jane@shop.example', createdAt: new Date().toISOString() },
  ],
};

describe('AdminPage', () => {
  it('shows the platform overview to admins', async () => {
    signInDev('speedolive369@gmail.com');
    mockFetch((url) => {
      if (url.pathname === '/api/me') return jsonResponse(me(true));
      if (url.pathname === '/api/admin/overview') return jsonResponse(overview);
      return undefined;
    });
    renderApp(<AdminPage />, { route: '/app/admin', path: '/app/admin' });

    expect(await screen.findByRole('heading', { name: 'Admin console' })).toBeInTheDocument();
    expect(await screen.findByTestId('stat-Users')).toHaveTextContent('42');
    expect(screen.getByTestId('stat-Demo attempts (7 days)')).toHaveTextContent('23');
    expect(screen.getByText('Tried the live demo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'jane@shop.example' })).toHaveAttribute('href', '/app/admin/users/u9');
  });

  it('sends non-admins back to their dashboard', async () => {
    signInDev();
    const spy = mockFetch((url) => (url.pathname === '/api/me' ? jsonResponse(me(false)) : undefined));
    renderApp(<AdminPage />, { route: '/app/admin', path: '/app/admin', extraRoutes: [{ path: '/app', element: <LocationProbe /> }] });

    expect(await screen.findByTestId('location')).toHaveTextContent('/app');
    expect(spy.mock.calls.some(([u]) => String(u).includes('/admin/'))).toBe(false);
  });
});
