import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, MailCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyAuthError, safeNext, useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './AuthLayout';

/** Router state passed by RegisterPage right after sign-up. */
export interface VerifyEmailState {
  /** Firebase accepted the verification email. */
  sent?: boolean;
  /** Why the verification email could not be sent. */
  sendError?: string | null;
}

export function VerifyEmailPage() {
  const { user, mode, resendVerification, refreshUser, signOut } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const initial = (location.state ?? {}) as VerifyEmailState;
  const [sent, setSent] = useState(Boolean(initial.sent) && !initial.sendError);
  const [sendError, setSendError] = useState<string | null>(initial.sendError ?? null);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);

  if (mode === 'dev' || user?.emailVerified) return <Navigate to={next} replace />;

  const email = <strong className="text-slate-700">{user?.email}</strong>;

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={
        sent ? (
          <>We sent a verification link to {email}. Click it, then come back here. Check your spam folder too.</>
        ) : (
          <>Confirm {email} to start using your account. Open the verification link we emailed you, or send a new one below.</>
        )
      }
      footer={
        <span className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          <button
            type="button"
            className="cursor-pointer text-slate-500 hover:text-slate-700"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            Use a different account
          </button>
          <Link to="/" className="text-slate-500 hover:text-slate-700">
            Back to home
          </Link>
        </span>
      }
    >
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        <MailCheck className="h-7 w-7" />
      </div>
      {sendError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle />
          <AlertTitle>We couldn't send the verification email</AlertTitle>
          <AlertDescription>{sendError}</AlertDescription>
        </Alert>
      )}
      {notYet && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>We couldn't confirm verification yet. Open the link in the email, then try again.</AlertDescription>
        </Alert>
      )}
      <div className="space-y-3">
        <Button
          className="w-full"
          size="lg"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            setNotYet(false);
            try {
              const fresh = await refreshUser();
              if (fresh?.emailVerified) {
                toast.success('Email verified — welcome aboard!');
                navigate(next, { replace: true });
              } else setNotYet(true);
            } catch (e) {
              toast.error(friendlyAuthError(e));
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? <Spinner /> : <RefreshCw />} I've verified my email
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            try {
              await resendVerification();
              setSendError(null);
              setSent(true);
              toast.success(`Verification email sent to ${user?.email ?? 'your inbox'}.`);
            } catch (e) {
              const msg = friendlyAuthError(e);
              setSendError(msg);
              toast.error(msg);
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? <Spinner /> : null} {sent || sendError ? 'Resend verification email' : 'Send verification email'}
        </Button>
      </div>
    </AuthLayout>
  );
}
