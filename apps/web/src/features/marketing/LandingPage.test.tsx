import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_PLANS, type Plan } from '@chatpilot/shared';
import { LandingPage } from './LandingPage';
import { LocationProbe, jsonResponse, mockFetch, renderApp } from '@/test/utils';

vi.mock('@/features/demo/LiveDemo', () => ({ LiveDemo: () => <div data-testid="live-demo">demo</div> }));

// Deliberately unusual values so the test proves prices come from the API, not hardcoded defaults.
const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Tryout',
    description: 'Kick the tyres.',
    priceMonthly: 0,
    currency: 'USD',
    limits: { chatbots: 1, messagesPerMonth: 77, crawlsPerMonth: 2, pagesPerCrawl: 9, leadsPerMonth: 5, knowledgeCharsPerBot: 1000, retentionDays: 7 },
    features: { leadCapture: true, removeBranding: false, csvExport: false, allowedOrigins: false },
  },
  {
    id: 'pro',
    name: 'Galaxy',
    description: 'Lots.',
    priceMonthly: 4321,
    currency: 'USD',
    highlighted: true,
    limits: { chatbots: 9, messagesPerMonth: 98765, crawlsPerMonth: 50, pagesPerCrawl: 100, leadsPerMonth: 500, knowledgeCharsPerBot: 1000, retentionDays: 90 },
    features: { leadCapture: true, removeBranding: true, csvExport: true, allowedOrigins: true },
  },
  {
    id: 'business',
    name: 'Custom',
    description: 'Talk to us.',
    priceMonthly: null,
    currency: 'USD',
    limits: { chatbots: 25, messagesPerMonth: 1, crawlsPerMonth: 1, pagesPerCrawl: 1, leadsPerMonth: 1, knowledgeCharsPerBot: 1, retentionDays: 1 },
    features: { leadCapture: true, removeBranding: true, csvExport: true, allowedOrigins: true },
  },
];

describe('LandingPage', () => {
  it('renders pricing from GET /api/public/plans without sending credentials', async () => {
    const spy = mockFetch((url) => (url.pathname === '/api/public/plans' ? jsonResponse({ items: PLANS }) : undefined));
    renderApp(<LandingPage />, { route: '/', path: '/' });

    // Default catalogue shows as a placeholder; the API response replaces it.
    await screen.findByText('Galaxy');
    const galaxy = screen.getByTestId('plan-pro');
    expect(galaxy).toHaveTextContent('$4,321');
    expect(galaxy).toHaveTextContent('98,765 messages / month');
    expect(within(galaxy).getByText('Most popular')).toBeInTheDocument();
    expect(screen.getByTestId('plan-free')).toHaveTextContent('$0');
    const custom = screen.getByTestId('plan-business');
    expect(custom).toHaveTextContent('Contact us');
    // No default catalogue prices leak in
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
    expect(screen.queryByText('Starter')).not.toBeInTheDocument();

    const call = spy.mock.calls.find(([u]) => String(u).includes('/public/plans'))!;
    expect(((call[1] as RequestInit).headers as Record<string, string>).Authorization).toBeUndefined();

    expect(await screen.findByTestId('live-demo')).toBeInTheDocument();
  });

  it('falls back to the default catalogue with a notice when the API is down', async () => {
    mockFetch(() => jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500));
    renderApp(<LandingPage />, { route: '/', path: '/' });
    expect(await screen.findByText(/live pricing couldn't be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByTestId('plan-pro')).toHaveTextContent(DEFAULT_PLANS.find((p) => p.id === 'pro')!.name);
  });

  it('hero URL form sends signed-out visitors to register with next=wizard', async () => {
    mockFetch((url) => (url.pathname === '/api/public/plans' ? jsonResponse({ items: PLANS }) : undefined));
    renderApp(<LandingPage />, { route: '/', path: '/', extraRoutes: [{ path: '/register', element: <LocationProbe /> }] });
    const input = screen.getAllByLabelText('Enter your website URL')[0];
    await userEvent.type(input, 'acme.example{enter}');
    const target = `/app/chatbots/new?url=${encodeURIComponent('https://acme.example/')}`;
    expect(await screen.findByTestId('location')).toHaveTextContent(`/register?next=${encodeURIComponent(target)}`);
  });

  it('validates the hero URL', async () => {
    mockFetch((url) => (url.pathname === '/api/public/plans' ? jsonResponse({ items: PLANS }) : undefined));
    renderApp(<LandingPage />, { route: '/', path: '/' });
    const input = screen.getAllByLabelText('Enter your website URL')[0];
    await userEvent.type(input, 'nope{enter}');
    expect(await screen.findByText(/enter a valid website address/i)).toBeInTheDocument();
  });
});
