import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import {
  actionContinueUrl,
  AuthContext,
  friendlyAuthError,
  needsEmailVerification,
  RequireAuth,
  safeNext,
  sendWithContinueUrl,
  type AuthContextValue,
  type AuthUser,
} from './auth';
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

function firebaseAuthValue(user: AuthUser | null): AuthContextValue {
  const noop = async () => undefined;
  return {
    user,
    loading: false,
    mode: 'firebase',
    signIn: noop,
    signUp: async () => ({ verificationSent: true, verificationError: null }),
    signOut: noop,
    resetPassword: noop,
    resendVerification: noop,
    refreshUser: async () => user,
    getIdToken: async () => null,
  };
}

function renderGuarded(user: AuthUser | null, ui: ReactElement, route = '/app/chatbots?tab=x') {
  return render(
    <AuthContext.Provider value={firebaseAuthValue(user)}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/app/*" element={ui} />
          <Route path="/verify-email" element={<LocationProbe />} />
          <Route path="/login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const unverified: AuthUser = { uid: 'u1', email: 'new@example.com', emailVerified: false };
const verified: AuthUser = { ...unverified, emailVerified: true };

describe('RequireAuth email verification (firebase mode)', () => {
  it('redirects unverified users to /verify-email with ?next', () => {
    renderGuarded(unverified, <RequireAuth><p>secret dashboard</p></RequireAuth>);
    expect(screen.getByTestId('location')).toHaveTextContent(`/verify-email?next=${encodeURIComponent('/app/chatbots?tab=x')}`);
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
  });

  it('lets verified users (incl. Google sign-ins) through', () => {
    renderGuarded(verified, <RequireAuth><p>secret dashboard</p></RequireAuth>);
    expect(screen.getByText('secret dashboard')).toBeInTheDocument();
  });

  it('allowUnverified renders the verify page itself for unverified users', () => {
    renderGuarded(unverified, <RequireAuth allowUnverified><p>verify page</p></RequireAuth>);
    expect(screen.getByText('verify page')).toBeInTheDocument();
  });

  it('still sends signed-out visitors to /login', () => {
    renderGuarded(null, <RequireAuth allowUnverified><p>verify page</p></RequireAuth>);
    expect(screen.getByTestId('location')).toHaveTextContent('/login?next=');
  });

  it('needsEmailVerification ignores dev mode', () => {
    expect(needsEmailVerification(unverified, 'dev')).toBe(false);
    expect(needsEmailVerification(unverified, 'firebase')).toBe(true);
    expect(needsEmailVerification(verified, 'firebase')).toBe(false);
    expect(needsEmailVerification(null, 'firebase')).toBe(false);
  });
});
