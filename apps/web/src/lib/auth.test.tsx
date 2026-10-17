import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { actionContinueUrl, friendlyAuthError, RequireAuth, safeNext, sendWithContinueUrl } from './auth';
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

describe('sendWithContinueUrl', () => {
  it('sends with a continue URL on the current origin', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await sendWithContinueUrl(send, '/verify-email');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ url: `${window.location.origin}/verify-email` });
    expect(actionContinueUrl('/login')).toBe(`${window.location.origin}/login`);
  });

  it('retries without a continue URL when Firebase rejects the domain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Firebase: Error (auth/unauthorized-continue-uri).'), { code: 'auth/unauthorized-continue-uri' }))
      .mockResolvedValueOnce(undefined);
    await sendWithContinueUrl(send, '/verify-email');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('surfaces other Firebase errors instead of swallowing them', async () => {
    const err = Object.assign(new Error('Firebase: Error (auth/too-many-requests).'), { code: 'auth/too-many-requests' });
    const send = vi.fn().mockRejectedValue(err);
    await expect(sendWithContinueUrl(send, '/verify-email')).rejects.toBe(err);
    expect(send).toHaveBeenCalledTimes(1);
    expect(friendlyAuthError(err)).toBe('Too many attempts. Please wait a moment and try again.');
    expect(friendlyAuthError(Object.assign(new Error('Firebase: Error (auth/something-new).'), { code: 'auth/something-new' }))).toBe(
      'Error (auth/something-new).',
    );
  });
});
