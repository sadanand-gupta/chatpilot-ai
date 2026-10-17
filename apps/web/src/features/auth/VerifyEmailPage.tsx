import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyAuthError, safeNext, useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from './AuthLayout';

export function VerifyEmailPage() {
  const { user, mode, resendVerification, refreshUser, signOut } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);

  if (mode === 'dev' || user?.emailVerified) return <Navigate to={next} replace />;

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={
        <>
          We sent a verification link to <strong className="text-slate-700">{user?.email}</strong>. Click it, then come back here.
        </>
      }
      footer={
        <span className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          <Link to={next} className="font-medium text-brand-600 hover:underline">
            Continue to dashboard
          </Link>
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
        </span>
      }
    >
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        <MailCheck className="h-7 w-7" />
      </div>
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
              toast.success('Verification email sent again.');
            } catch (e) {
              toast.error(friendlyAuthError(e));
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? <Spinner /> : null} Resend verification email
        </Button>
      </div>
    </AuthLayout>
  );
}
