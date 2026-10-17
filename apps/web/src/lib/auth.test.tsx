import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { RequireAuth, safeNext } from './auth';
import { LocationProbe, renderApp, signInDev } from '@/test/utils';

describe('RequireAuth', () => {
  it('redirects signed-out visitors to /login with ?next', async () => {
    renderApp(
      <RequireAuth>
        <p>secret dashboard</p>
      </RequireAuth>,
      { route: '/app/chatbots?tab=x', path: '/app/*', extraRoutes: [{ path: '/login', element: <LocationProbe /> }] },
    );
    expect(await screen.findByTestId('location')).toHaveTextContent(`/login?next=${encodeURIComponent('/app/chatbots?tab=x')}`);
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
  });

  it('renders children for signed-in users', async () => {
    signInDev();
    renderApp(
      <RequireAuth>
        <p>secret dashboard</p>
      </RequireAuth>,
      { route: '/app', path: '/app/*' },
    );
    expect(await screen.findByText('secret dashboard')).toBeInTheDocument();
  });
});

describe('safeNext', () => {
  it('only allows same-origin relative paths', () => {
    expect(safeNext('/app/chatbots/new?url=x')).toBe('/app/chatbots/new?url=x');
    expect(safeNext('https://evil.com')).toBe('/app');
    expect(safeNext('//evil.com')).toBe('/app');
    expect(safeNext(null)).toBe('/app');
  });
});
