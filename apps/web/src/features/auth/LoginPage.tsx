import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { friendlyAuthError, safeNext, useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './AuthLayout';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { signIn, mode } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next');
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const devMode = mode === 'dev';

  const form = useForm<LoginValues>({
    resolver: zodResolver(devMode ? loginSchema.extend({ password: z.string() }) : loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await signIn(v.email, v.password);
      navigate(safeNext(next), { replace: true });
    } catch (e) {
      setError(friendlyAuthError(e));
    }
  });

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : '/register';

  return (
    <AuthLayout
      title="Welcome back"
      documentTitle="Log in"
      subtitle="Sign in to manage your chatbots."
      footer={
        <>
          New here?{' '}
          <Link to={registerHref} className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Sign in">
        {devMode && (
          <Alert variant="warning">
            <AlertDescription>Dev mode: any email signs you in, the password is ignored.</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
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
        <FormField
          id="password"
          label={
            <span className="flex w-full items-center justify-between">
              Password
              {!devMode && (
                <Link to="/forgot-password" className="text-xs font-medium text-brand-600 hover:underline">
                  Forgot password?
                </Link>
              )}
            </span>
          }
          error={errors.password?.message}
        >
          <div className="relative">
            <Input
              id="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              className="pr-10"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...form.register('password')}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-slate-400 hover:text-slate-600"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>
        <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null} Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
