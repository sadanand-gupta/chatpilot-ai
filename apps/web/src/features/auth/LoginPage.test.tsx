import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage, RegisterPage, devLoginSchema } from './LoginPage';
import { AuthContext, type AuthContextValue, type AuthUser } from '@/lib/auth';
import { LocationProbe, jsonResponse, mockFetch, renderApp } from '@/test/utils';

describe('LoginPage (dev mode)', () => {
  it('shows validation errors and does not call the API for an invalid email', async () => {
    const fetchSpy = mockFetch();
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('has no password field or Google button in dev mode', () => {
    mockFetch();
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
  });

  it('signs in and redirects to ?next', async () => {
    const spy = mockFetch((url) =>
      url.pathname === '/api/dev/login' ? jsonResponse({ token: 't1', uid: 'u1', email: 'a@b.co' }) : undefined,
    );
    renderApp(<LoginPage />, {
      route: '/login?next=%2Fapp%2Fleads',
      path: '/login',
      extraRoutes: [{ path: '/app/leads', element: <LocationProbe /> }],
    });
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app/leads'));
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.co' });
  });

  it('shows the API error message when sign-in fails', async () => {
    mockFetch(() => jsonResponse({ error: { code: 'forbidden', message: 'Dev login disabled' } }, 403));
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Dev login disabled')).toBeInTheDocument();
  });

  it('register page asks for a name and creates the account', async () => {
    mockFetch((url) => (url.pathname === '/api/dev/login' ? jsonResponse({ token: 't1', uid: 'u1', email: 'a@b.co' }) : jsonResponse({})));
    renderApp(<RegisterPage />, { route: '/register', path: '/register', extraRoutes: [{ path: '/app', element: <LocationProbe /> }] });
    await userEvent.type(screen.getByLabelText('Your name'), 'Priya');
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app'));
  });
});

function firebaseAuth(signInWithGoogle: AuthContextValue['signInWithGoogle']): AuthContextValue {
  return {
    user: null,
    loading: false,
    mode: 'firebase',
    signInWithGoogle,
    devSignIn: async () => undefined,
    signOut: async () => undefined,
    getIdToken: async () => null,
  };
}

function renderFirebase(signInWithGoogle: AuthContextValue['signInWithGoogle'], route = '/login?next=%2Fapp%2Fleads') {
  return render(
    <AuthContext.Provider value={firebaseAuth(signInWithGoogle)}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app/leads" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('LoginPage (firebase mode)', () => {
  const user: AuthUser = { uid: 'g1', email: 'owner@gmail.com', emailVerified: true };

  it('offers only Google sign-in: no email or password fields', () => {
    renderFirebase(vi.fn());
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('signs in with Google and redirects to ?next', async () => {
    const google = vi.fn().mockResolvedValue(user);
    renderFirebase(google);
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(google).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app/leads'));
  });

  it('stays on the page without an error when the popup is closed', async () => {
    renderFirebase(vi.fn().mockResolvedValue(null));
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /continue with google/i })).toBeEnabled());
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a friendly error when Google sign-in fails', async () => {
    const err = Object.assign(new Error('Firebase: Error (auth/unauthorized-domain).'), { code: 'auth/unauthorized-domain' });
    renderFirebase(vi.fn().mockRejectedValue(err));
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(await screen.findByText(/not authorized in Firebase/)).toBeInTheDocument();
  });
});

describe('devLoginSchema', () => {
  it('requires a valid email; name is optional', () => {
    expect(devLoginSchema.safeParse({ email: '' }).success).toBe(false);
    expect(devLoginSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
  });
});
