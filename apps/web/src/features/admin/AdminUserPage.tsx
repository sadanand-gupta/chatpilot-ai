import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Bot, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminChatbot, AdminUpdateUserInput, AdminUser, AdminUserDetail, PlanId } from '@chatpilot/shared';
import { api, errorMessage } from '@/lib/api';
import { usePlans } from '@/lib/hooks';
import { qk } from '@/lib/queryKeys';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState } from '@/components/ErrorState';
import { ActivityLog } from './ActivityLog';
import { RequireAdmin } from './AdminPage';
import { AdminChatbotRows, ChatbotTableHead, DeleteChatbotDialog, UserBadges } from './AdminTables';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

function ManageCard({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const plans = usePlans();
  const [confirm, setConfirm] = useState<'suspend' | 'delete' | null>(null);

  const update = useMutation({
    mutationFn: (input: AdminUpdateUserInput) => api.patch<AdminUser>(`/admin/users/${encodeURIComponent(user.uid)}`, input),
    onSuccess: (_u, input) => {
      toast.success(input.planId ? 'Plan updated' : input.suspended ? 'Account suspended' : 'Account restored');
      queryClient.invalidateQueries({ queryKey: qk.admin() });
      setConfirm(null);
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not update the account')),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/admin/users/${encodeURIComponent(user.uid)}`),
    onSuccess: () => {
      toast.success('Account deleted');
      queryClient.invalidateQueries({ queryKey: qk.admin() });
      navigate('/app/admin?tab=users', { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete the account')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage account</CardTitle>
        <CardDescription>Every change here is recorded in the activity log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="admin-plan">Plan</Label>
          <Select value={user.planId} onValueChange={(v) => update.mutate({ planId: v as PlanId })} disabled={update.isPending}>
            <SelectTrigger id="admin-plan" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(plans.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {user.isAdmin ? (
          <p className="text-sm text-slate-500">Admin accounts can't be suspended or deleted from the console.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.suspended ? (
              <Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ suspended: false })}>
                <ShieldCheck /> Restore access
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirm('suspend')}>
                <Ban /> Suspend
              </Button>
            )}
            <Button variant="destructive" onClick={() => setConfirm('delete')}>
              <Trash2 /> Delete account
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirm === 'suspend'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Suspend this account?"
        description={`${user.email} won't be able to use the dashboard until you restore access. Their published chatbots keep answering visitors.`}
        confirmLabel="Suspend account"
        loading={update.isPending}
        onConfirm={() => update.mutate({ suspended: true })}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this account?"
        description="All of their chatbots, knowledge, conversations and leads are permanently deleted. This can't be undone."
        confirmLabel="Delete account"
        confirmText={user.email}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Card>
  );
}

function UserDetail({ uid }: { uid: string }) {
  const q = useQuery({
    queryKey: qk.admin('user', uid),
    queryFn: ({ signal }) => api.get<AdminUserDetail>(`/admin/users/${encodeURIComponent(uid)}`, { signal }),
  });
  const [toDelete, setToDelete] = useState<AdminChatbot | null>(null);
  useDocumentTitle(q.data ? `${q.data.user.email} — Admin` : 'Admin console');

  if (q.isError) return <ErrorState error={q.error} title="Couldn't load this user" onRetry={() => q.refetch()} />;
  if (!q.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const { user, plan, usage, chatbots } = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link to="/app/admin?tab=users" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
            <ArrowLeft className="h-4 w-4" /> All users
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {user.email || user.uid} <UserBadges user={user} />
          </span>
        }
        description={[user.displayName, user.businessName].filter(Boolean).join(' · ') || undefined}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              <Fact label="Joined">{formatDateTime(user.createdAt)}</Fact>
              <Fact label="Last sign-in">{user.lastSignInAt ? formatDateTime(user.lastSignInAt) : '—'}</Fact>
              <Fact label="Last active">{user.lastActiveAt ? formatDateTime(user.lastActiveAt) : '—'}</Fact>
              <Fact label="Sign-ins">{formatNumber(user.signInCount ?? 0)}</Fact>
              <Fact label="Plan">{plan.name}</Fact>
              <Fact label="Chatbots">{formatNumber(user.chatbotCount)}</Fact>
              <Fact label="Messages this month">
                {formatNumber(usage.messages)} / {formatNumber(plan.limits.messagesPerMonth)}
              </Fact>
              <Fact label="Crawls this month">
                {formatNumber(usage.crawls)} / {formatNumber(plan.limits.crawlsPerMonth)}
              </Fact>
              <Fact label="Leads this month">{formatNumber(usage.leads)}</Fact>
            </dl>
            <p className="mt-5 break-all font-mono text-xs text-slate-400">uid: {user.uid}</p>
          </CardContent>
        </Card>
        <ManageCard user={user} />
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-slate-900">Chatbots</h2>
        {chatbots.length === 0 ? (
          <EmptyState icon={Bot} title="No chatbots" description="This user hasn't created a chatbot yet." />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <ChatbotTableHead showOwner={false} />
                </TableRow>
              </TableHeader>
              <TableBody>
                <AdminChatbotRows items={chatbots} showOwner={false} onDelete={setToDelete} />
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-slate-900">Activity</h2>
        <ActivityLog uid={user.uid} />
      </section>

      <DeleteChatbotDialog bot={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}

export function AdminUserPage() {
  const { uid = '' } = useParams();
  return (
    <RequireAdmin>
      <UserDetail uid={uid} />
    </RequireAdmin>
  );
}
