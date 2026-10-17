import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle } from 'lucide-react';
import { friendlyAuthError, safeNext, useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './AuthLayout';

/** Dev mode (AUTH_MODE=dev) only: passwordless local login. Production uses Google sign-in. */
export const devLoginSchema = z.object({
  displayName: z.string().trim().max(120).optional(),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
});
type DevLoginValues = z.infer<typeof devLoginSchema>;

type Variant = 'login' | 'register';

const COPY: Record<Variant, { title: string; documentTitle: string; subtitle: string; devButton: string }> = {
  login: { title: 'Welcome back', documentTitle: 'Log in', subtitle: 'Sign in to manage your chatbots.', devButton: 'Sign in' },
  register: {
    title: 'Create your account',
    documentTitle: 'Sign up',
    subtitle: 'Build a chatbot trained on your website in a few minutes.',
    devButton: 'Create account',
  },
};

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AuthPage({ variant }: { variant: Variant }) {
  const { signInWithGoogle, devSignIn, mode } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next');
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const devMode = mode === 'dev';
  const copy = COPY[variant];

  const form = useForm<DevLoginValues>({ resolver: zodResolver(devLoginSchema), defaultValues: { displayName: '', email: '' } });
  const { errors, isSubmitting } = form.formState;

  const onDevSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await devSignIn(v.email, v.displayName || undefined);
      // Dev tokens carry no name claim, so save it on the API profile too (best-effort).
      if (v.displayName) api.patch('/me', { displayName: v.displayName }).catch(() => undefined);
      navigate(safeNext(next), { replace: true });
    } catch (e) {
      setError(friendlyAuthError(e));
    }
  });

  const onGoogle = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      if (await signInWithGoogle()) navigate(safeNext(next), { replace: true });
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setGoogleBusy(false);
    }
  };

  const otherHref = (path: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

  return (
    <AuthLayout
      title={copy.title}
      documentTitle={copy.documentTitle}
      subtitle={copy.subtitle}
      footer={
        variant === 'login' ? (
          <>
            New here?{' '}
            <Link to={otherHref('/register')} className="font-medium text-brand-600 hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link to={otherHref('/login')} className="font-medium text-brand-600 hover:underline">
              Sign in
            </Link>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {devMode ? (
          <form onSubmit={onDevSubmit} noValidate className="space-y-4" aria-label={variant === 'login' ? 'Sign in' : 'Create account'}>
            <Alert variant="warning">
              <AlertDescription>Dev mode: any email signs you in. Production uses Google sign-in.</AlertDescription>
            </Alert>
            {variant === 'register' && (
              <FormField id="displayName" label="Your name" error={errors.displayName?.message}>
                <Input id="displayName" autoComplete="name" placeholder="Priya Sharma" {...form.register('displayName')} />
              </FormField>
            )}
            <FormField id="email" label="Email" error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...form.register('email')}
              />
            </FormField>
            <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
              {isSubmitting ? <Spinner /> : null} {copy.devButton}
            </Button>
          </form>
        ) : (
          <Button type="button" variant="outline" className="w-full gap-3" size="lg" onClick={onGoogle} disabled={googleBusy}>
            {googleBusy ? <Spinner /> : <GoogleLogo />} Continue with Google
          </Button>
        )}
        <p className="text-center text-xs text-slate-500">
          By continuing you agree to our{' '}
          <Link to="/terms" className="underline hover:text-slate-700">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="underline hover:text-slate-700">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </AuthLayout>
  );
}

export function LoginPage() {
  return <AuthPage variant="login" />;
}

export function RegisterPage() {
  return <AuthPage variant="register" />;
}
