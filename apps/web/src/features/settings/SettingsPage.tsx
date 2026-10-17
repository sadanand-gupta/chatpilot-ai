import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, LogOut, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { updateProfileSchema, type MeResponse, type UpdateProfileInput } from '@chatpilot/shared';
import { api, errorMessage } from '@/lib/api';
import { friendlyAuthError, useAuth } from '@/lib/auth';
import { useMe } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState } from '@/components/ErrorState';

function ProfileCard({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const values = (m: MeResponse): UpdateProfileInput => ({ displayName: m.user.displayName ?? '', businessName: m.user.businessName ?? '' });
  const form = useForm<UpdateProfileInput>({ resolver: zodResolver(updateProfileSchema), defaultValues: values(me) });
  const { errors, isDirty } = form.formState;

  useEffect(() => {
    if (!form.formState.isDirty) form.reset(values(me));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const save = useMutation({
    mutationFn: (v: UpdateProfileInput) => api.patch<MeResponse>('/me', v),
    onSuccess: (res) => {
      queryClient.setQueryData(qk.me(), res);
      form.reset(values(res));
      toast.success('Profile updated');
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not update your profile')),
  });

  return (
    <Card>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your personal and business details.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="displayName" label="Your name" error={errors.displayName?.message}>
            <Input id="displayName" autoComplete="name" {...form.register('displayName')} />
          </FormField>
          <FormField id="businessName" label="Business name" error={errors.businessName?.message}>
            <Input id="businessName" autoComplete="organization" {...form.register('businessName')} />
          </FormField>
          <FormField id="email" label="Email" hint="Your sign-in email can't be changed here.">
            <Input id="email" value={me.user.email} readOnly disabled />
          </FormField>
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-slate-800">Member since</span>
            <p className="flex h-10 items-center text-sm text-slate-600">{formatDate(me.user.createdAt)}</p>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t border-slate-100 pt-4 sm:pt-4">
          <Button type="submit" disabled={!isDirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function SecurityCard() {
  const { user, mode, resetPassword, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in & security</CardTitle>
        <CardDescription>
          {mode === 'dev' ? (
            <>
              <Badge variant="warning" className="mr-1">
                Dev mode
              </Badge>
              Passwords aren't used in dev mode.
            </>
          ) : (
            'Change your password with a secure reset link.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {mode === 'firebase' && (
          <Button
            variant="outline"
            disabled={sending || !user}
            onClick={async () => {
              if (!user) return;
              setSending(true);
              try {
                await resetPassword(user.email);
                toast.success(`Password reset email sent to ${user.email}`);
              } catch (e) {
                toast.error(friendlyAuthError(e));
              } finally {
                setSending(false);
              }
            }}
          >
            <KeyRound /> {sending ? 'Sending…' : 'Send password reset email'}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={async () => {
            await signOut();
            queryClient.clear();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut /> Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

function DeleteAccountCard() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.del<{ ok: true }>('/me'),
    onSuccess: async () => {
      setOpen(false);
      await signOut().catch(() => undefined);
      queryClient.clear();
      toast.success('Your account and all its data were deleted.');
      navigate('/', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete your account')),
  });
  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="text-red-700">Delete account</CardTitle>
        <CardDescription>
          Permanently delete your account and all chatbots, website knowledge, conversations and leads. Installed widgets stop working. This can't be undone.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete my account
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your account?"
        description="All of your data will be permanently erased."
        confirmText="DELETE"
        confirmLabel="Delete account"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </Card>
  );
}

export function SettingsPage() {
  const me = useMe();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Manage your profile, security and account." />
      {me.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : me.isError || !me.data ? (
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      ) : (
        <ProfileCard me={me.data} />
      )}
      <SecurityCard />
      <DeleteAccountCard />
    </div>
  );
}
