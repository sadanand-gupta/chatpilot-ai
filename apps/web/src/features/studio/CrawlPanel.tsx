import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  Globe,
  Loader2,
  MinusCircle,
  PenLine,
  Play,
  RefreshCw,
  Square,
  XCircle,
} from 'lucide-react';
import type { Chatbot, CrawlJob, CrawlPageResult, Paginated } from '@chatpilot/shared';
import { api, isQuotaError } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { cn, formatNumber, hostnameOf, normalizeUrl } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { QuotaNotice } from '@/components/QuotaNotice';
import { friendlyError, isTerminalCrawl, safeHref, studioKeys, useChatbot, useMe, useSourcesSummary } from './lib';

export interface CrawlPanelProps {
  chatbot: Chatbot;
  /** Start a crawl automatically when the chatbot has never been crawled. */
  autoStart?: boolean;
  onContinue?: () => void;
  /** Jump to manual content entry (knowledge review). */
  onAddManual?: () => void;
}

const STATUS_BADGE: Record<CrawlJob['status'], { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  queued: { label: 'Queued', variant: 'secondary' },
  running: { label: 'Crawling', variant: 'default' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'warning' },
};

export function CrawlPanel({ chatbot: initialChatbot, autoStart, onContinue, onAddManual }: CrawlPanelProps) {
  const id = initialChatbot.id;
  const qc = useQueryClient();
  const { data: chatbot = initialChatbot } = useChatbot(id, initialChatbot);
  const me = useMe();
  const planMaxPages = me.data?.plan.limits.pagesPerCrawl;
  const sources = useSourcesSummary(id);

  const [startUrl, setStartUrl] = useState(chatbot.websiteUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [maxPages, setMaxPages] = useState<number | ''>('');
  const [jobId, setJobId] = useState<string | null>(null);

  const latest = useQuery({
    queryKey: studioKeys.latestCrawl(id),
    queryFn: () => api.get<Paginated<CrawlJob>>(`/chatbots/${encodeURIComponent(id)}/crawl-jobs?limit=1`),
  });
  const activeJobId = jobId ?? latest.data?.items[0]?.id ?? null;

  const job = useQuery({
    queryKey: qk.crawlJob(id, activeJobId ?? ''),
    queryFn: () => api.get<CrawlJob>(`/chatbots/${encodeURIComponent(id)}/crawl-jobs/${encodeURIComponent(activeJobId!)}`),
    enabled: Boolean(activeJobId),
    initialData: () => (activeJobId && latest.data?.items[0]?.id === activeJobId ? latest.data.items[0] : undefined),
    refetchInterval: (q) => (isTerminalCrawl(q.state.data?.status) ? false : 1500),
    refetchIntervalInBackground: false,
  });
  const current = activeJobId ? job.data : undefined;

  // When a job reaches a terminal state, refresh everything that depends on crawled knowledge.
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const st = current?.status;
    if (st && prevStatus.current && !isTerminalCrawl(prevStatus.current) && isTerminalCrawl(st)) {
      void qc.invalidateQueries({ queryKey: qk.sources(id) });
      void qc.invalidateQueries({ queryKey: qk.chatbot(id) });
      void qc.invalidateQueries({ queryKey: qk.me() });
    }
    prevStatus.current = st;
  }, [current?.status, id, qc]);

  const start = useMutation({
    mutationFn: (body: { url?: string; maxPages?: number }) =>
      api.post<CrawlJob>(`/chatbots/${encodeURIComponent(id)}/crawl`, body),
    onSuccess: (j) => {
      qc.setQueryData(qk.crawlJob(id, j.id), j);
      prevStatus.current = j.status;
      setJobId(j.id);
      void qc.invalidateQueries({ queryKey: studioKeys.latestCrawl(id) });
    },
  });

  const cancel = useMutation({
    mutationFn: (jid: string) =>
      api.post<CrawlJob>(`/chatbots/${encodeURIComponent(id)}/crawl-jobs/${encodeURIComponent(jid)}/cancel`),
    onSuccess: (j) => qc.setQueryData(qk.crawlJob(id, j.id), j),
  });

  const launch = () => {
    const normalized = normalizeUrl(startUrl);
    if (!normalized) {
      setUrlError('Enter a valid website address, e.g. https://example.com');
      return;
    }
    setUrlError(null);
    setStartUrl(normalized);
    start.mutate({
      url: normalized,
      maxPages: typeof maxPages === 'number' ? maxPages : undefined,
    });
  };

  // Auto-start once when the bot has never been crawled.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current || !latest.isSuccess) return;
    if (latest.data.items.length === 0 && !jobId) {
      autoStarted.current = true;
      launch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, latest.isSuccess, latest.data, jobId]);

  const hasActiveContent = (sources.data?.items ?? []).some((s) => s.status === 'active');
  const canContinue = (current?.status === 'completed' && current.stats.processed > 0) || hasActiveContent;
  const running = current ? !isTerminalCrawl(current.status) : false;

  if (latest.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {chatbot.siteMeta && <SiteMetaCard chatbot={chatbot} />}

      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-brand-600" aria-hidden /> Read your website
            </CardTitle>
            <CardDescription>
              We visit your public pages, extract the readable text and turn it into your chatbot's knowledge.
            </CardDescription>
          </div>
          {current && <Badge variant={STATUS_BADGE[current.status].variant}>{STATUS_BADGE[current.status].label}</Badge>}
        </CardHeader>
        <CardContent className="space-y-5">
          {(!current || isTerminalCrawl(current.status)) && (
            <form
              className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                launch();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="crawl-url">Start URL</Label>
                <Input
                  id="crawl-url"
                  value={startUrl}
                  onChange={(e) => setStartUrl(e.target.value)}
                  inputMode="url"
                  autoComplete="url"
                  aria-invalid={Boolean(urlError)}
                  aria-describedby={urlError ? 'crawl-url-error' : undefined}
                />
                {urlError && (
                  <p id="crawl-url-error" className="text-xs font-medium text-red-600" role="alert">
                    {urlError}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="crawl-max">Max pages</Label>
                <Input
                  id="crawl-max"
                  type="number"
                  min={1}
                  max={planMaxPages ?? 200}
                  placeholder={planMaxPages ? String(planMaxPages) : 'Plan max'}
                  value={maxPages}
                  onChange={(e) => {
                    const v = e.target.value === '' ? '' : Math.max(1, Math.min(planMaxPages ?? 200, Number(e.target.value)));
                    setMaxPages(v);
                  }}
                />
              </div>
              <Button type="submit" disabled={start.isPending} className="sm:mb-0">
                {start.isPending ? <Loader2 className="animate-spin" aria-hidden /> : current ? <RefreshCw aria-hidden /> : <Play aria-hidden />}
                {current ? 'Crawl again' : 'Start crawl'}
              </Button>
            </form>
          )}

          {start.isError && <StartError error={start.error} onAddManual={onAddManual} />}

          {current && <CrawlProgress job={current} />}

          {running && current && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Crawling {hostnameOf(current.startUrl)} — this usually takes under a
                minute.
              </p>
              <Button variant="outline" size="sm" onClick={() => cancel.mutate(current.id)} disabled={cancel.isPending}>
                <Square aria-hidden /> Cancel
              </Button>
            </div>
          )}

          {current?.status === 'failed' && (
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>The crawl failed</AlertTitle>
              <AlertDescription>
                <p>{current.error || 'We could not read this website.'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={launch} disabled={start.isPending}>
                    <RefreshCw aria-hidden /> Retry
                  </Button>
                  {onAddManual && (
                    <Button size="sm" variant="outline" onClick={onAddManual}>
                      <PenLine aria-hidden /> Add content manually
                    </Button>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {current?.status === 'cancelled' && (
            <Alert variant="warning">
              <MinusCircle />
              <AlertTitle>Crawl cancelled</AlertTitle>
              <AlertDescription>Pages processed before cancelling were kept. Start again any time.</AlertDescription>
            </Alert>
          )}

          {current?.status === 'completed' && (
            <Alert>
              <CheckCircle2 className="!text-emerald-600" />
              <AlertTitle>
                Crawl completed — read {formatNumber(current.stats.processed)} page{current.stats.processed === 1 ? '' : 's'} from your site
              </AlertTitle>
              <AlertDescription>Next, review what was extracted and add anything that's missing.</AlertDescription>
            </Alert>
          )}

          {current?.hint && (
            <Alert variant="warning" data-testid="crawl-hint">
              <PenLine />
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>
                <p>{current.hint}</p>
                {onAddManual && (
                  <Button size="sm" className="mt-3" onClick={onAddManual}>
                    <PenLine aria-hidden /> Add content manually
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {onContinue && (
        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
          {!canContinue && (
            <p className="text-sm text-slate-500">
              {running ? 'You can continue once the crawl finishes.' : 'Crawl your site or add content manually to continue.'}
            </p>
          )}
          {!canContinue && onAddManual && !running && (
            <Button variant="outline" onClick={onAddManual}>
              <PenLine aria-hidden /> Add content manually
            </Button>
          )}
          <Button onClick={onContinue} disabled={!canContinue}>
            Review knowledge <ArrowRight aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function StartError({ error, onAddManual }: { error: unknown; onAddManual?: () => void }) {
  if (isQuotaError(error)) return <QuotaNotice error={error} />;
  const fe = friendlyError(error);
  return (
    <Alert variant="destructive">
      <XCircle />
      <AlertTitle>{fe.title}</AlertTitle>
      <AlertDescription>
        <p>{fe.description}</p>
        {onAddManual && (
          <Button size="sm" variant="outline" className="mt-3" onClick={onAddManual}>
            <PenLine aria-hidden /> Add content manually instead
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function CrawlProgress({ job }: { job: CrawlJob }) {
  const { discovered, processed, skipped, failed } = job.stats;
  const done = processed + skipped + failed;
  const total = Math.max(1, Math.min(Math.max(discovered, done), job.maxPages || Infinity));
  const terminal = isTerminalCrawl(job.status);
  const pct = job.status === 'completed' ? 100 : Math.min(99, Math.round((done / total) * 100));
  const pages = useMemo(() => [...job.pages].reverse(), [job.pages]);

  return (
    <div className="space-y-4" data-testid="crawl-progress">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
          <span>
            {terminal ? 'Finished' : job.status === 'queued' ? 'Waiting for a crawler…' : 'Reading pages…'}
          </span>
          <span aria-hidden>{pct}%</span>
        </div>
        <div
          className="relative h-2.5 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Crawl progress"
        >
          <div
            className={cn(
              'h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-[width] duration-700 ease-out',
              job.status === 'failed' && 'from-red-400 to-red-500',
            )}
            style={{ width: `${Math.max(pct, terminal ? pct : 4)}%` }}
          />
          {!terminal && <div className="absolute inset-0 animate-pulse bg-white/30" aria-hidden />}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="Discovered" value={discovered} className="text-slate-900" />
        <Counter label="Processed" value={processed} className="text-emerald-600" />
        <Counter label="Skipped" value={skipped} className="text-amber-600" />
        <Counter label="Failed" value={failed} className="text-red-600" />
      </dl>

      {pages.length > 0 && (
        <div className="rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Pages</div>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto" aria-live="polite" aria-label="Crawled pages">
            {pages.map((p) => (
              <PageRow key={p.url} page={p} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Counter({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100" data-testid={`crawl-counter-${label.toLowerCase()}`}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cn('mt-0.5 text-2xl font-semibold tabular-nums transition-all', className)}>{formatNumber(value)}</dd>
    </div>
  );
}

function PageRow({ page }: { page: CrawlPageResult }) {
  const Icon = page.status === 'processed' ? CheckCircle2 : page.status === 'skipped' ? MinusCircle : XCircle;
  const color = page.status === 'processed' ? 'text-emerald-600' : page.status === 'skipped' ? 'text-amber-500' : 'text-red-500';
  let path = page.url;
  try {
    const u = new URL(page.url);
    path = u.pathname + u.search || '/';
  } catch {
    /* keep raw */
  }
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', color)} aria-label={page.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-800">{page.title || path}</p>
        <p className="truncate text-xs text-slate-500">
          {safeHref(page.url) ? (
            <a href={safeHref(page.url)} target="_blank" rel="noreferrer noopener" className="hover:underline">
              {path}
            </a>
          ) : (
            <span>{path}</span>
          )}
          {page.reason && <span className="ml-2 text-slate-500">· {page.reason}</span>}
        </p>
      </div>
      {typeof page.chars === 'number' && page.status === 'processed' && (
        <span className="shrink-0 text-xs tabular-nums text-slate-400">{formatNumber(page.chars, { compact: true })} chars</span>
      )}
    </li>
  );
}

function SiteMetaCard({ chatbot }: { chatbot: Chatbot }) {
  const m = chatbot.siteMeta!;
  const ogImage = safeHref(m.ogImage);
  const favicon = safeHref(m.favicon);
  const [imgOk, setImgOk] = useState(true);
  const [iconOk, setIconOk] = useState(true);
  return (
    <Card className="overflow-hidden rounded-2xl" data-testid="site-meta-card">
      <div className="flex flex-col sm:flex-row">
        {ogImage && imgOk && (
          <img
            src={ogImage}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImgOk(false)}
            className="h-36 w-full object-cover sm:h-auto sm:w-56"
          />
        )}
        <div className="flex min-w-0 flex-1 items-start gap-3 p-5">
          {favicon && iconOk ? (
            <img src={favicon} alt="" referrerPolicy="no-referrer" onError={() => setIconOk(false)} className="h-10 w-10 rounded-lg bg-white object-contain ring-1 ring-slate-200" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Globe className="h-5 w-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{m.siteName || m.title || hostnameOf(m.url)}</p>
            {m.title && m.siteName && <p className="truncate text-sm text-slate-600">{m.title}</p>}
            {m.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{m.description}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{hostnameOf(m.url)}</span>
              {m.themeColor && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: m.themeColor }} /> {m.themeColor}
                </span>
              )}
              {m.navLinks && m.navLinks.length > 0 && <span>· {m.navLinks.length} menu items</span>}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
