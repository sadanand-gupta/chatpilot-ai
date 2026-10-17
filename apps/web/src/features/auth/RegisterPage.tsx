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
import type { VerifyEmailState } from './VerifyEmailPage';

export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Please enter your name').max(120),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
});
type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { signUp, mode } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next');
  const [error, setError] = useState<string | null>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const result = await signUp(v.email, v.password, v.displayName);
      // Save the display name on the API profile too (best-effort).
      api.patch('/me', { displayName: v.displayName }).catch(() => undefined);
      if (mode === 'firebase') {
        const state: VerifyEmailState = { sent: result.verificationSent, sendError: result.verificationError };
        navigate(`/verify-email?next=${encodeURIComponent(safeNext(next))}`, { replace: true, state });
      } else {
        navigate(safeNext(next), { replace: true });
      }
    } catch (e) {
      setError(friendlyAuthError(e));
    }
  });

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <AuthLayout
      title="Create your account"
      documentTitle="Sign up"
      subtitle="Build a chatbot trained on your website in a few minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link to={loginHref} className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Create account">
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <FormField id="displayName" label="Your name" error={errors.displayName?.message}>
          <Input id="displayName" autoComplete="name" placeholder="Priya Sharma" aria-invalid={!!errors.displayName} {...form.register('displayName')} />
        </FormField>
        <FormField id="email" label="Work email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" aria-invalid={!!errors.email} {...form.register('email')} />
        </FormField>
        <FormField id="password" label="Password" hint="At least 8 characters." error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register('password')} />
        </FormField>
        <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null} Create account
        </Button>
        <p className="text-center text-xs text-slate-500">
          By creating an account you agree to our{' '}
          <Link to="/terms" className="underline hover:text-slate-700">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="underline hover:text-slate-700">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthLayout>
  );
}
