import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyAuthError, useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

/** Shown in the app shell (firebase mode) until the user verifies their email address. */
export function EmailVerificationBanner() {
  const { user, mode, resendVerification } = useAuth();
  const [sending, setSending] = useState(false);
  if (mode !== 'firebase' || !user || user.emailVerified) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 text-sm text-amber-900 sm:flex-row sm:items-center sm:px-6">
        <MailWarning className="hidden h-4 w-4 shrink-0 text-amber-600 sm:block" aria-hidden="true" />
        <p className="flex-1">
          Please verify <strong>{user.email}</strong> to secure your account. Check your inbox for the verification link.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 bg-white"
            disabled={sending}
            onClick={async () => {
              setSending(true);
              try {
                await resendVerification();
                toast.success('Verification email sent.');
              } catch (e) {
                toast.error(friendlyAuthError(e));
              } finally {
                setSending(false);
              }
            }}
          >
            Resend email
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/verify-email">I've verified</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
