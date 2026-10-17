import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage, loginSchema } from './LoginPage';
import { registerSchema } from './RegisterPage';
import { LocationProbe, jsonResponse, mockFetch, renderApp } from '@/test/utils';

describe('LoginPage', () => {
  it('shows validation errors and does not call the API for an invalid email', async () => {
    const fetchSpy = mockFetch();
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires an email', async () => {
    mockFetch();
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
  });

  it('signs in (dev mode) and redirects to ?next', async () => {
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
});

describe('auth schemas', () => {
  it('login requires a password in firebase mode', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
  it('register enforces 8+ character passwords', () => {
    expect(registerSchema.safeParse({ displayName: 'A', email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ displayName: 'A', email: 'a@b.co', password: 'longenough' }).success).toBe(true);
  });
});
