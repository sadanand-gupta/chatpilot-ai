import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import {
  AuthContext,
  friendlyAuthError,
  isGoogleAccount,
  RedirectIfAuthed,
  RequireAuth,
  safeNext,
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

describe('friendlyAuthError', () => {
  it('maps Google sign-in errors and falls back to the Firebase message', () => {
    const err = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });
    expect(friendlyAuthError(err('auth/popup-blocked'))).toMatch(/blocked the Google sign-in window/);
    expect(friendlyAuthError(err('auth/operation-not-allowed'))).toMatch(/Google sign-in is not enabled/);
    expect(friendlyAuthError(err('auth/something-new'))).toBe('Error (auth/something-new).');
  });
});

describe('isGoogleAccount', () => {
  it('accepts only users with a google.com provider', () => {
    expect(isGoogleAccount({ providerData: [{ providerId: 'google.com' }] } as never)).toBe(true);
    expect(isGoogleAccount({ providerData: [{ providerId: 'password' }] } as never)).toBe(false);
    expect(isGoogleAccount({ providerData: [{ providerId: 'password' }, { providerId: 'google.com' }] } as never)).toBe(true);
  });
});

function firebaseAuthValue(user: AuthUser | null): AuthContextValue {
  const noop = async () => undefined;
  return {
    user,
    loading: false,
    mode: 'firebase',
    signInWithGoogle: async () => user,
    devSignIn: noop,
    signOut: noop,
    getIdToken: async () => null,
  };
}

function renderGuarded(user: AuthUser | null, route: string) {
  return render(
    <AuthContext.Provider value={firebaseAuthValue(user)}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/app/*" element={<RequireAuth><p>secret dashboard</p></RequireAuth>} />
          <Route path="/login" element={<RedirectIfAuthed><LocationProbe /></RedirectIfAuthed>} />
          <Route path="/app/leads" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const googleUser: AuthUser = { uid: 'g1', email: 'owner@gmail.com', emailVerified: true };

describe('guards (firebase mode)', () => {
  it('sends signed-out visitors to /login with ?next', () => {
    renderGuarded(null, '/app/chatbots?tab=x');
    expect(screen.getByTestId('location')).toHaveTextContent(`/login?next=${encodeURIComponent('/app/chatbots?tab=x')}`);
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
  });

  it('lets signed-in Google users into the app', () => {
    renderGuarded(googleUser, '/app/chatbots');
    expect(screen.getByText('secret dashboard')).toBeInTheDocument();
  });

  it('sends signed-in users away from /login to ?next', () => {
    renderGuarded(googleUser, `/login?next=${encodeURIComponent('/app/leads')}`);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/leads$/);
  });
});
