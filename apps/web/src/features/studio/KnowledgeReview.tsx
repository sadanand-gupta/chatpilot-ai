import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  PenLine,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  Chatbot,
  CreateSourceInput,
  KnowledgeSource,
  KnowledgeSourceDetail,
  Paginated,
  SourceType,
} from '@chatpilot/shared';
import { api, errorMessage, isQuotaError } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { cn, formatNumber } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormField, Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { QuotaNotice } from '@/components/QuotaNotice';
import { safeHref, studioKeys, useChatbot, useMe } from './lib';

export interface KnowledgeReviewProps {
  chatbotId: string;
  /** Open the FAQ / manual-content dialog on mount (e.g. from the crawl step's hint). */
  initialDialog?: 'faq' | 'manual' | null;
  onDialogConsumed?: () => void;
  onContinue?: () => void;
}

type SourcesData = InfiniteData<Paginated<KnowledgeSource>, string | null>;

const GROUPS: { type: SourceType; label: string; icon: typeof FileText; empty: string }[] = [
  { type: 'page', label: 'Pages', icon: FileText, empty: 'No crawled pages yet.' },
  { type: 'faq', label: 'FAQs', icon: HelpCircle, empty: 'Add common questions with the exact answers you want the bot to give.' },
  { type: 'manual', label: 'Manual content', icon: PenLine, empty: 'Paste policies, price lists or anything your site does not cover.' },
];

export function KnowledgeReview({ chatbotId, initialDialog, onDialogConsumed, onContinue }: KnowledgeReviewProps) {
  const id = chatbotId;
  const qc = useQueryClient();
  const chatbotQ = useChatbot(id);
  const me = useMe();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<'faq' | 'manual' | null>(null);
  const [toDelete, setToDelete] = useState<KnowledgeSource | null>(null);

  useEffect(() => {
    if (initialDialog) {
      setDialog(initialDialog);
      onDialogConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDialog]);

  const list = useInfiniteQuery({
    queryKey: studioKeys.sourcesList(id),
    queryFn: ({ pageParam }) =>
      api.get<Paginated<KnowledgeSource>>(
        `/chatbots/${encodeURIComponent(id)}/sources?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const all = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) => s.title.toLowerCase().includes(q) || (s.url ?? '').toLowerCase().includes(q) || s.preview.toLowerCase().includes(q));
  }, [all, search]);

  const active = all.filter((s) => s.status === 'active');
  const totals = {
    activePages: active.filter((s) => s.type === 'page').length,
    chars: active.reduce((n, s) => n + s.charCount, 0),
    chunks: active.reduce((n, s) => n + s.chunkCount, 0),
  };
  const charLimit = me.data?.plan.limits.knowledgeCharsPerBot;

  const patchCache = (sourceId: string, patch: Partial<KnowledgeSource> | null) => {
    qc.setQueryData<SourcesData>(studioKeys.sourcesList(id), (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              items: patch === null ? p.items.filter((s) => s.id !== sourceId) : p.items.map((s) => (s.id === sourceId ? { ...s, ...patch } : s)),
            })),
          }
        : old,
    );
  };

  const toggle = useMutation({
    mutationFn: ({ source, status }: { source: KnowledgeSource; status: 'active' | 'excluded' }) =>
      api.patch<KnowledgeSource>(`/chatbots/${encodeURIComponent(id)}/sources/${encodeURIComponent(source.id)}`, { status }),
    onMutate: ({ source, status }) => {
      const prev = source.status;
      patchCache(source.id, { status });
      return { prev };
    },
    onError: (e, { source }, ctx) => {
      if (ctx) patchCache(source.id, { status: ctx.prev });
      toast.error(errorMessage(e, 'Could not update this source.'));
    },
    onSuccess: (s) => patchCache(s.id, s),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: studioKeys.sourcesSummary(id) });
      void qc.invalidateQueries({ queryKey: qk.chatbot(id) });
    },
  });

  const remove = useMutation({
    mutationFn: (source: KnowledgeSource) =>
      api.del<{ ok: true }>(`/chatbots/${encodeURIComponent(id)}/sources/${encodeURIComponent(source.id)}`),
    onSuccess: (_r, source) => {
      patchCache(source.id, null);
      setToDelete(null);
      toast.success('Source deleted');
      void qc.invalidateQueries({ queryKey: qk.sources(id) });
      void qc.invalidateQueries({ queryKey: qk.chatbot(id) });
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete this source.')),
  });

  return (
    <div className="space-y-6">
      {/* totals */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active pages" value={formatNumber(totals.activePages)} />
        <Stat label="Knowledge chunks" value={formatNumber(totals.chunks)} />
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs text-slate-500">Characters used</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
            {formatNumber(totals.chars, { compact: true })}
            {charLimit ? <span className="text-sm font-normal text-slate-500"> / {formatNumber(charLimit, { compact: true })}</span> : null}
          </p>
          {charLimit ? <Progress value={(totals.chars / charLimit) * 100} className="mt-2 h-1.5" aria-label="Knowledge characters used" /> : null}
        </div>
      </div>
      {list.hasNextPage && <p className="-mt-3 text-xs text-slate-500">Totals cover the sources loaded below.</p>}

      <Card className="rounded-2xl">
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-brand-600" aria-hidden /> Knowledge sources
            </CardTitle>
            <CardDescription>Exclude anything irrelevant; the bot only answers from active sources.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog('faq')}>
              <Plus aria-hidden /> Add FAQ
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog('manual')}>
              <PenLine aria-hidden /> Add content
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles, URLs and text…"
              className="pl-9"
              aria-label="Search knowledge sources"
            />
          </div>

          {list.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : list.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load sources</AlertTitle>
              <AlertDescription>
                {errorMessage(list.error)}{' '}
                <Button size="sm" variant="link" onClick={() => list.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            GROUPS.map((g) => {
              const items = filtered.filter((s) => s.type === g.type);
              const Icon = g.icon;
              return (
                <section key={g.type} aria-labelledby={`group-${g.type}`}>
                  <h3 id={`group-${g.type}`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Icon className="h-4 w-4 text-slate-400" aria-hidden /> {g.label}
                    <Badge variant="secondary">{items.length}</Badge>
                  </h3>
                  {items.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
                      {search ? 'No matches.' : g.empty}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                      {items.map((s) => (
                        <SourceRow
                          key={s.id}
                          chatbotId={id}
                          source={s}
                          onToggle={(status) => toggle.mutate({ source: s, status })}
                          onDelete={() => setToDelete(s)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />} Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {chatbotQ.data && <BusinessInstructions chatbot={chatbotQ.data} />}

      {onContinue && (
        <div className="flex justify-end">
          <Button onClick={onContinue} disabled={active.length === 0}>
            Customize your bot <ArrowRight aria-hidden />
          </Button>
        </div>
      )}

      <AddSourceDialog chatbotId={id} kind={dialog} onClose={() => setDialog(null)} />

      <Dialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this source?</DialogTitle>
            <DialogDescription>
              “{toDelete?.title}” and its {formatNumber(toDelete?.chunkCount ?? 0)} knowledge chunks will be removed. To keep it for later,
              exclude it instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => toDelete && remove.mutate(toDelete)} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="animate-spin" aria-hidden />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function SourceRow({
  chatbotId,
  source,
  onToggle,
  onDelete,
}: {
  chatbotId: string;
  source: KnowledgeSource;
  onToggle: (status: 'active' | 'excluded') => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: studioKeys.source(chatbotId, source.id),
    queryFn: () =>
      api.get<KnowledgeSourceDetail>(`/chatbots/${encodeURIComponent(chatbotId)}/sources/${encodeURIComponent(source.id)}`),
    enabled: open,
    staleTime: 60_000,
  });
  const failed = source.status === 'failed';
  const switchId = `src-${source.id}`;

  return (
    <li className={cn('bg-white', source.status !== 'active' && 'bg-slate-50/70')} data-testid="knowledge-source-row">
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Hide content of ${source.title}` : `Show content of ${source.title}`}
          className="mt-0.5 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm font-medium', source.status === 'active' ? 'text-slate-900' : 'text-slate-500')}>{source.title}</p>
          {source.url && !safeHref(source.url) && <p className="truncate text-xs text-slate-500">{source.url}</p>}
          {safeHref(source.url) && (
            <a
              href={safeHref(source.url)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex max-w-full items-center gap-1 truncate text-xs text-slate-500 hover:text-brand-600 hover:underline"
            >
              <span className="truncate">{source.url}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{formatNumber(source.charCount)} chars</span>
            <span aria-hidden>·</span>
            <span>
              {formatNumber(source.chunkCount)} chunk{source.chunkCount === 1 ? '' : 's'}
            </span>
            {source.status === 'excluded' && <Badge variant="secondary">Excluded</Badge>}
            {failed && <Badge variant="destructive">Failed</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Label htmlFor={switchId} className="sr-only">
            Include {source.title}
          </Label>
          <Switch
            id={switchId}
            checked={source.status === 'active'}
            disabled={failed}
            onCheckedChange={(c) => onToggle(c ? 'active' : 'excluded')}
          />
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Delete ${source.title}`}>
            <Trash2 className="text-slate-500" />
          </Button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 pl-11">
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100">
            {detail.isLoading ? (
              <span className="flex items-center gap-2 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading content…
              </span>
            ) : detail.isError ? (
              <span className="text-red-600">{errorMessage(detail.error)}</span>
            ) : (
              detail.data?.content || source.preview || <em className="text-slate-400">No text extracted.</em>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

const faqSchema = z.object({
  question: z.string().trim().min(3, 'Question is too short').max(500),
  answer: z.string().trim().min(1, 'Answer is required').max(4000),
});
const manualSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  content: z.string().trim().min(1, 'Content is required').max(50000),
});

function AddSourceDialog({ chatbotId, kind, onClose }: { chatbotId: string; kind: 'faq' | 'manual' | null; onClose: () => void }) {
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {kind === 'faq' && <FaqForm chatbotId={chatbotId} onDone={onClose} />}
        {kind === 'manual' && <ManualForm chatbotId={chatbotId} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function useCreateSource(chatbotId: string, onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSourceInput) => api.post<KnowledgeSource>(`/chatbots/${encodeURIComponent(chatbotId)}/sources`, body),
    onSuccess: () => {
      toast.success('Added to your knowledge base');
      void qc.invalidateQueries({ queryKey: qk.sources(chatbotId) });
      void qc.invalidateQueries({ queryKey: qk.chatbot(chatbotId) });
      onDone();
    },
  });
}

function FaqForm({ chatbotId, onDone }: { chatbotId: string; onDone: () => void }) {
  const form = useForm<z.infer<typeof faqSchema>>({ resolver: zodResolver(faqSchema), defaultValues: { question: '', answer: '' } });
  const create = useCreateSource(chatbotId, onDone);
  return (
    <form onSubmit={form.handleSubmit((v) => create.mutate({ type: 'faq', ...v }))} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Add an FAQ</DialogTitle>
        <DialogDescription>The bot will use this answer whenever visitors ask something similar.</DialogDescription>
      </DialogHeader>
      <FormField id="faq-q" label="Question" error={form.formState.errors.question?.message}>
        <Input id="faq-q" placeholder="Do you deliver on weekends?" {...form.register('question')} />
      </FormField>
      <FormField id="faq-a" label="Answer" error={form.formState.errors.answer?.message}>
        <Textarea id="faq-a" rows={5} placeholder="Yes — we deliver Saturday and Sunday between 9am and 6pm." {...form.register('answer')} />
      </FormField>
      {create.isError && (isQuotaError(create.error) ? <QuotaNotice error={create.error} /> : <ErrorLine error={create.error} />)}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" aria-hidden />} Add FAQ
        </Button>
      </DialogFooter>
    </form>
  );
}

function ManualForm({ chatbotId, onDone }: { chatbotId: string; onDone: () => void }) {
  const form = useForm<z.infer<typeof manualSchema>>({ resolver: zodResolver(manualSchema), defaultValues: { title: '', content: '' } });
  const create = useCreateSource(chatbotId, onDone);
  const len = form.watch('content').length;
  return (
    <form onSubmit={form.handleSubmit((v) => create.mutate({ type: 'manual', ...v }))} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Add content manually</DialogTitle>
        <DialogDescription>
          Paste text your website doesn't show clearly — services and prices, policies, opening hours, delivery areas.
        </DialogDescription>
      </DialogHeader>
      <FormField id="man-title" label="Title" error={form.formState.errors.title?.message}>
        <Input id="man-title" placeholder="Price list 2026" {...form.register('title')} />
      </FormField>
      <FormField id="man-content" label="Content" error={form.formState.errors.content?.message} hint={`${formatNumber(len)} / 50,000 characters`}>
        <Textarea id="man-content" rows={10} {...form.register('content')} />
      </FormField>
      {create.isError && (isQuotaError(create.error) ? <QuotaNotice error={create.error} /> : <ErrorLine error={create.error} />)}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" aria-hidden />} Add content
        </Button>
      </DialogFooter>
    </form>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  return (
    <p className="text-sm font-medium text-red-600" role="alert">
      {errorMessage(error)}
    </p>
  );
}

function BusinessInstructions({ chatbot }: { chatbot: Chatbot }) {
  const qc = useQueryClient();
  const saved = chatbot.config.customInstructions ?? '';
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const dirty = value.trim() !== saved.trim();

  const save = useMutation({
    mutationFn: () =>
      api.put<Chatbot>(`/chatbots/${encodeURIComponent(chatbot.id)}/config`, { ...chatbot.config, customInstructions: value.trim() }),
    onSuccess: (c) => {
      qc.setQueryData(qk.chatbot(chatbot.id), c);
      toast.success('Business instructions saved');
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save instructions.')),
  });

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>Business instructions</CardTitle>
        <CardDescription>
          Extra guidance for how the bot should answer — e.g. “Always mention free parking”, “Never quote prices for custom orders; ask for
          contact details instead”.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="biz-instructions" className="sr-only">
          Business instructions
        </Label>
        <Textarea
          id="biz-instructions"
          rows={5}
          maxLength={2000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Optional"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{formatNumber(value.length)} / 2,000</span>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save instructions
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
