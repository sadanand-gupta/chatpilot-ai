import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, ArrowLeft, MailCheck } from 'lucide-react';
import { friendlyAuthError, useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './AuthLayout';

const schema = z.object({ email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address') });

export function ForgotPasswordPage() {
  const { resetPassword, mode } = useAuth();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await resetPassword(email);
      setSentTo(email);
    } catch (e) {
      const code = (e as { code?: string }).code;
      // Don't reveal whether an account exists.
      if (code === 'auth/user-not-found') setSentTo(email);
      else setError(friendlyAuthError(e));
    }
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to choose a new password."
      footer={
        <Link to="/login" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </Link>
      }
    >
      {mode === 'dev' ? (
        <Alert variant="warning">
          <AlertTitle>Not available in dev mode</AlertTitle>
          <AlertDescription>Dev mode has no passwords — just sign in with any email.</AlertDescription>
        </Alert>
      ) : sentTo ? (
        <Alert>
          <MailCheck />
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>
            If an account exists for <strong>{sentTo}</strong>, a password reset link is on its way. It may take a minute — check your spam folder too.
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register('email')} />
          </FormField>
          <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null} Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
