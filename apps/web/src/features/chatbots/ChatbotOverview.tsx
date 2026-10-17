import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { CheckCircle2, Circle, ExternalLink, FileText, Layers, Lock, MessageSquare, Rocket, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { buildHostedUrl, updateChatbotSchema, type Chatbot, type InstallStatus } from '@chatpilot/shared';
import { api, errorMessage, ApiError } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { appConfig } from '@/lib/config';
import { useMe } from '@/lib/hooks';
import { cn, formatDate, formatNumber, hostnameOf, normalizeUrl } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { CopyButton } from '@/components/ui/copy-button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChatbotStatusBadge } from '@/components/StatusBadge';
import { useDeleteChatbot } from './useDeleteChatbot';
import { SafeExternalLink } from '@/components/SafeExternalLink';

/* ---------------- Settings form ---------------- */

const originRe = /^https?:\/\/[^/\s]+$/i;

const settingsFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  businessName: z.string().trim().min(1, 'Business name is required').max(120),
  websiteUrl: z
    .string()
    .trim()
    .min(3, 'Website is required')
    .max(2048)
    .refine((v) => normalizeUrl(v) !== null, 'Enter a valid website URL'),
  allowedOriginsText: z
    .string()
    .max(20 * 300)
    .refine((v) => parseOrigins(v).length <= 20, 'Up to 20 origins')
    .refine(
      (v) => parseOrigins(v).every((o) => originRe.test(o)),
      'Each origin must look like https://example.com (no path or trailing slash)',
    ),
});
type SettingsValues = z.infer<typeof settingsFormSchema>;

function parseOrigins(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,]+/)
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),
  );
}

function SettingsCard({ chatbot }: { chatbot: Chatbot }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const originsAllowed = me.data ? me.data.plan.features.allowedOrigins : true;
  const toValues = (c: Chatbot): SettingsValues => ({
    name: c.name,
    businessName: c.businessName,
    websiteUrl: c.websiteUrl,
    allowedOriginsText: (c.allowedOrigins ?? []).join('\n'),
  });
  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsFormSchema), defaultValues: toValues(chatbot) });
  const { errors, isDirty } = form.formState;

  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toValues(chatbot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot]);

  const save = useMutation({
    mutationFn: (v: SettingsValues) => {
      const body = updateChatbotSchema.parse({
        name: v.name,
        businessName: v.businessName,
        websiteUrl: normalizeUrl(v.websiteUrl) ?? v.websiteUrl,
        ...(originsAllowed ? { allowedOrigins: parseOrigins(v.allowedOriginsText) } : {}),
      });
      return api.patch<Chatbot>(`/chatbots/${chatbot.id}`, body);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.chatbot(chatbot.id), updated);
      queryClient.invalidateQueries({ queryKey: qk.chatbots() });
      queryClient.invalidateQueries({ queryKey: qk.installStatus(chatbot.id) });
      form.reset(toValues(updated));
      toast.success('Settings saved');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'validation_error') {
        const fe = (e.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
        for (const [k, msgs] of Object.entries(fe)) {
          const field = (k === 'allowedOrigins' ? 'allowedOriginsText' : k) as keyof SettingsValues;
          form.setError(field, { message: msgs?.[0] ?? 'Invalid value' });
        }
      }
      toast.error(errorMessage(e, 'Could not save settings'));
    },
  });

  return (
    <Card>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <CardHeader>
          <CardTitle>Chatbot settings</CardTitle>
          <CardDescription>Basic details and where the widget may be embedded.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="cb-name" label="Chatbot name" hint="Only you see this name." error={errors.name?.message}>
            <Input id="cb-name" aria-invalid={!!errors.name} {...form.register('name')} />
          </FormField>
          <FormField id="cb-business" label="Business name" hint="Shown to visitors in the widget." error={errors.businessName?.message}>
            <Input id="cb-business" aria-invalid={!!errors.businessName} {...form.register('businessName')} />
          </FormField>
          <FormField
            id="cb-website"
            className="sm:col-span-2"
            label="Website URL"
            hint="Changing this doesn't re-crawl automatically — start a new crawl from the Knowledge tab."
            error={errors.websiteUrl?.message}
          >
            <Input id="cb-website" type="url" inputMode="url" aria-invalid={!!errors.websiteUrl} {...form.register('websiteUrl')} />
          </FormField>
          <FormField
            id="cb-origins"
            className="sm:col-span-2"
            label={
              <span className="inline-flex items-center gap-1.5">
                Allowed origins {!originsAllowed && <Lock className="h-3.5 w-3.5 text-slate-400" aria-label="Requires upgrade" />}
              </span>
            }
            hint={
              originsAllowed ? (
                'One per line, e.g. https://www.example.com. Leave empty to allow any website (rate limits still apply).'
              ) : (
                <>
                  Restricting origins is available on paid plans.{' '}
                  <Link to="/app/billing" className="font-medium text-brand-600 hover:underline">
                    Upgrade
                  </Link>
                </>
              )
            }
            error={errors.allowedOriginsText?.message}
          >
            <Textarea
              id="cb-origins"
              rows={3}
              disabled={!originsAllowed}
              placeholder={'https://example.com\nhttps://www.example.com'}
              className="font-mono text-xs"
              aria-invalid={!!errors.allowedOriginsText}
              {...form.register('allowedOriginsText')}
            />
          </FormField>
        </CardContent>
        <CardFooter className="justify-end border-t border-slate-100 pt-4 sm:pt-4">
          <Button type="button" variant="ghost" disabled={!isDirty || save.isPending} onClick={() => form.reset(toValues(chatbot))}>
            Reset
          </Button>
          <Button type="submit" disabled={!isDirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/* ---------------- Install status ---------------- */

function InstallStatusCard({ chatbot }: { chatbot: Chatbot }) {
  const q = useQuery({
    queryKey: qk.installStatus(chatbot.id),
    queryFn: ({ signal }) => api.get<InstallStatus>(`/chatbots/${chatbot.id}/install-status`, { signal }),
    refetchInterval: 60_000,
  });
  const s = q.data;
  const detected = Boolean(s?.lastSeenAt);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Install status</CardTitle>
        <CardDescription>We detect the widget the first time it loads on your site.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : q.isError ? (
          <p className="text-slate-500">{errorMessage(q.error)}</p>
        ) : (
          <>
            <StatusLine ok={Boolean(s?.published)} label={s?.published ? 'Published' : 'Not published yet'} />
            <StatusLine
              ok={detected}
              label={
                detected ? (
                  <>
                    Seen on <span className="font-medium">{hostnameOf(s?.lastSeenOrigin)}</span>{' '}
                    {s?.lastSeenAt ? formatDistanceToNow(parseISO(s.lastSeenAt), { addSuffix: true }) : ''}
                  </>
                ) : (
                  'Not detected on a website yet'
                )
              }
            />
            <p className="text-xs text-slate-500">
              {s?.allowedOrigins.length ? `Restricted to ${s.allowedOrigins.length} origin(s).` : 'Allowed on any website.'}
            </p>
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link to="?tab=publish">
                <Rocket /> {s?.published ? 'Get embed code' : 'Publish & install'}
              </Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
      <span className={cn(ok ? 'text-slate-800' : 'text-slate-500')}>{label}</span>
    </p>
  );
}

/* ---------------- Danger zone ---------------- */

function DangerZone({ chatbot }: { chatbot: Chatbot }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const del = useDeleteChatbot({ onDeleted: () => navigate('/app/chatbots', { replace: true }) });
  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="text-red-700">Danger zone</CardTitle>
        <CardDescription>
          Deleting removes this chatbot, its knowledge, conversations and leads permanently. The widget stops working immediately.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete chatbot
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${chatbot.name}?`}
        description="This can't be undone. Type the chatbot name to confirm."
        confirmText={chatbot.name}
        confirmLabel="Delete permanently"
        loading={del.isPending}
        onConfirm={() => del.mutate(chatbot.id)}
      />
    </Card>
  );
}

/* ---------------- Overview ---------------- */

export function ChatbotOverview({ chatbot, onTab }: { chatbot: Chatbot; onTab: (tab: string) => void }) {
  const stats = chatbot.stats;
  const hostedUrl = chatbot.status === 'published' ? buildHostedUrl(appConfig.appUrl, chatbot.publicId) : null;
  const statItems = [
    { label: 'Knowledge sources', value: stats?.sources ?? 0, icon: FileText, tab: 'knowledge' },
    { label: 'Knowledge chunks', value: stats?.chunks ?? 0, icon: Layers, tab: 'knowledge' },
    { label: 'Conversations', value: stats?.conversations ?? 0, icon: MessageSquare, tab: 'conversations' },
    { label: 'Leads', value: stats?.leads ?? 0, icon: UserPlus, tab: 'leads' },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Status</CardTitle>
              <ChatbotStatusBadge chatbot={chatbot} />
            </div>
            <CardDescription>
              {chatbot.status === 'published'
                ? `Version ${chatbot.publishedVersion ?? 1} published ${formatDate(chatbot.publishedAt)}.`
                : chatbot.status === 'unpublished'
                  ? 'This chatbot is unpublished — the widget is not answering visitors.'
                  : 'Draft — review knowledge, customize, then publish to go live.'}
              {chatbot.hasUnpublishedChanges && ' You have changes that are not live yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {statItems.map((s) => (
                <button
                  type="button"
                  key={s.label}
                  onClick={() => onTab(s.tab)}
                  className="cursor-pointer rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                >
                  <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                    <s.icon className="h-3.5 w-3.5" /> {s.label}
                  </dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{formatNumber(s.value)}</dd>
                </button>
              ))}
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onTab('knowledge')} variant="outline">
                Review knowledge
              </Button>
              <Button size="sm" onClick={() => onTab('customize')} variant="outline">
                Customize
              </Button>
              <Button size="sm" onClick={() => onTab('preview')} variant="outline">
                Preview
              </Button>
              <Button size="sm" onClick={() => onTab('publish')}>
                <Rocket /> {chatbot.status === 'published' ? 'Publish & install' : 'Publish'}
              </Button>
            </div>
          </CardContent>
        </Card>
        <SettingsCard chatbot={chatbot} />
        <DangerZone chatbot={chatbot} />
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Website</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <SafeExternalLink href={chatbot.websiteUrl} className="flex items-center gap-1.5 break-all font-medium text-brand-600 hover:underline">
              {hostnameOf(chatbot.websiteUrl)} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </SafeExternalLink>
            {chatbot.siteMeta?.title && <p className="text-slate-700">{chatbot.siteMeta.title}</p>}
            {chatbot.siteMeta?.description && <p className="line-clamp-3 text-slate-500">{chatbot.siteMeta.description}</p>}
            <p className="text-xs text-slate-400">Created {formatDate(chatbot.createdAt)}</p>
          </CardContent>
        </Card>
        <InstallStatusCard chatbot={chatbot} />
        {hostedUrl && (
          <Card>
            <CardHeader>
              <CardTitle>Hosted chat page</CardTitle>
              <CardDescription>A shareable full-page chat — no install needed.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Input readOnly value={hostedUrl} aria-label="Hosted chat URL" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <CopyButton value={hostedUrl} size="icon" />
              <Button asChild variant="outline" size="icon" aria-label="Open hosted page">
                <a href={hostedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
