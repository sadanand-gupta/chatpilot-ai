import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { ArrowRight, Check, Clock, Globe, Loader2, Monitor, RotateCcw, Smartphone, Sparkles, XCircle } from 'lucide-react';
import type { DemoSession, SiteMeta } from '@chatpilot/shared';
import { ApiError, publicApi } from '@/lib/api';
import { cn, hostnameOf, normalizeUrl } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DeviceFrame } from '@/features/studio/DeviceFrame';
import { studioKeys } from '@/features/studio/lib';
import { SiteSurface } from '@/features/studio/SiteSurface';
import { WidgetStage } from '@/features/studio/WidgetStage';

export interface LiveDemoProps {
  /** Landing-page embed: tighter spacing and smaller frames. */
  compact?: boolean;
}

const PROGRESS_STEPS = ['Checking site', 'Reading pages', 'Building knowledge', 'Ready'] as const;

/** Static example shown before a visitor runs the demo (clearly labelled as an example). */
const EXAMPLE_META: SiteMeta = {
  url: 'https://example.com',
  siteName: 'Sunrise Bakery',
  heroHeading: 'Fresh sourdough, baked every morning',
  heroText: 'Order online for same-day pickup, or visit our café on Lake Road.',
  navLinks: ['Menu', 'Order online', 'Catering', 'About', 'Contact'],
  themeColor: '#C2410C',
  frameable: false,
};

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.('change', cb);
      return () => mql.removeEventListener?.('change', cb);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

function demoErrorCopy(e: unknown): { title: string; description: string; jsHint?: boolean } {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'invalid_url':
        return { title: "That doesn't look like a website address", description: 'Try something like yourbusiness.com.' };
      case 'crawl_blocked':
        return {
          title: 'Your site blocked our crawler',
          description: e.message || 'The site refused automated access (firewall, bot protection or robots.txt).',
        };
      case 'rate_limited':
        return { title: 'Too many demos from your network', description: 'Please try again later — or create a free account to keep going.' };
      case 'network_error':
        return { title: "Couldn't reach ChatPilot", description: 'Check your connection and try again.' };
      default:
        return { title: 'The demo could not start', description: e.message || 'Please try again.' };
    }
  }
  return { title: 'The demo could not start', description: e instanceof Error ? e.message : 'Please try again.' };
}

export function LiveDemo({ compact = false }: LiveDemoProps) {
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [demoId, setDemoId] = useState<string | null>(null);
  const [submittedUrl, setSubmittedUrl] = useState('');

  const create = useMutation({
    mutationFn: (url: string) => publicApi.post<DemoSession>('/public/demo', { url }),
    onSuccess: (d) => setDemoId(d.demoId),
  });

  const poll = useQuery({
    queryKey: studioKeys.demo(demoId ?? ''),
    queryFn: () => publicApi.get<DemoSession>(`/public/demo/${encodeURIComponent(demoId!)}`),
    enabled: Boolean(demoId),
    initialData: () => (create.data && create.data.demoId === demoId ? create.data : undefined),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'crawling' ? false : 1500),
    retry: 2,
  });
  const demo = demoId ? poll.data : undefined;

  // Track progress stalls to show the "Building knowledge" phase honestly (pages stopped increasing).
  const [phase, setPhase] = useState(0);
  const lastPages = useRef<{ n: number; stalls: number }>({ n: -1, stalls: 0 });
  useEffect(() => {
    if (create.isPending) return setPhase(0);
    if (!demo) return;
    if (demo.status === 'ready') return setPhase(3);
    if (demo.status !== 'crawling') return;
    const lp = lastPages.current;
    if (demo.pagesProcessed === lp.n) lp.stalls += 1;
    else lastPages.current = { n: demo.pagesProcessed, stalls: 0 };
    if (demo.pagesProcessed === 0) setPhase(demo.siteMeta ? 1 : 0);
    else setPhase(lastPages.current.stalls >= 2 ? 2 : 1);
  }, [create.isPending, demo, poll.dataUpdatedAt]);

  const submit = () => {
    const n = normalizeUrl(input);
    if (!n) {
      setInputError('Enter your website address, e.g. yourbusiness.com');
      return;
    }
    setInputError(null);
    setInput(n);
    setSubmittedUrl(n);
    setDemoId(null);
    lastPages.current = { n: -1, stalls: 0 };
    create.mutate(n);
  };

  const restart = () => {
    setDemoId(null);
    create.reset();
  };

  const running = create.isPending || demo?.status === 'crawling';
  const ready = demo?.status === 'ready';
  const failed = demo?.status === 'failed';
  const error = create.error ?? (poll.isError && !demo ? poll.error : null);

  return (
    <div className={cn('w-full', compact ? 'space-y-6' : 'space-y-8')} data-testid="live-demo">
      {!ready && (
        <form
          className="mx-auto flex w-full max-w-2xl flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor="demo-url" className="sr-only">
              Enter your website URL
            </Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                id="demo-url"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter your website URL"
                inputMode="url"
                autoComplete="url"
                disabled={running}
                aria-invalid={Boolean(inputError)}
                aria-describedby={inputError ? 'demo-url-error' : undefined}
                className="h-12 rounded-xl pl-11 text-base shadow-sm"
              />
            </div>
            {inputError && (
              <p id="demo-url-error" role="alert" className="mt-1.5 text-left text-sm font-medium text-red-600">
                {inputError}
              </p>
            )}
          </div>
          <Button type="submit" size="lg" disabled={running} className="h-12 shrink-0 shadow-md">
            {running ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            See it on my site
          </Button>
        </form>
      )}

      {error != null && <DemoError error={error} onRetry={submit} />}

      {failed && demo && (
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <XCircle />
          <AlertTitle>We couldn't build a demo for {hostnameOf(demo.url)}</AlertTitle>
          <AlertDescription>
            <p>{demo.error || 'The crawl did not find readable content.'}</p>
            <p className="mt-2">
              If your site is built entirely with JavaScript, our crawler may not see its text. You can still create a chatbot and add your
              content manually.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={restart}>
                <RotateCcw aria-hidden /> Try another URL
              </Button>
              <Button size="sm" asChild>
                <Link to={registerHref(demo.url)}>Create your chatbot for free</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {running && <DemoProgress phase={phase} pages={demo?.pagesProcessed ?? 0} url={submittedUrl} />}

      {ready && demo ? (
        <ReadyDemo demo={demo} compact={compact} onRestart={restart} />
      ) : !running && !failed ? (
        <ExampleFrames compact={compact} />
      ) : null}
    </div>
  );
}

function registerHref(url: string) {
  return `/register?next=${encodeURIComponent(`/app/chatbots/new?url=${encodeURIComponent(url)}`)}`;
}

function DemoError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const c = demoErrorCopy(error);
  const rateLimited = error instanceof ApiError && error.code === 'rate_limited';
  return (
    <Alert variant={rateLimited ? 'warning' : 'destructive'} className="mx-auto max-w-2xl" data-testid="demo-error">
      <XCircle />
      <AlertTitle>{c.title}</AlertTitle>
      <AlertDescription>
        <p>{c.description}</p>
        {!rateLimited && (
          <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            <RotateCcw aria-hidden /> Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function DemoProgress({ phase, pages, url }: { phase: number; pages: number; url: string }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl bg-white p-5 shadow-lg ring-1 ring-slate-200 sm:p-6" role="status" aria-live="polite" data-testid="demo-progress">
      <p className="mb-4 text-sm text-slate-500">
        Building a chatbot for <span className="font-medium text-slate-800">{hostnameOf(url)}</span>…
      </p>
      <ol className="grid gap-3 sm:grid-cols-4">
        {PROGRESS_STEPS.map((label, i) => {
          const done = i < phase;
          const active = i === phase;
          return (
            <li
              key={label}
              className={cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-all duration-500 sm:flex-col sm:items-start sm:gap-2',
                active ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200' : done ? 'text-slate-700' : 'text-slate-400',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  done ? 'bg-emerald-500 text-white' : active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400',
                )}
              >
                {done ? <Check className="h-4 w-4" aria-hidden /> : active ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : i + 1}
              </span>
              <span className="font-medium">
                {label}
                {i === 1 && pages > 0 ? ` (${pages})` : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-[width] duration-700"
          style={{ width: `${[12, 45, 80, 100][phase] ?? 12}%` }}
        />
      </div>
    </div>
  );
}

function expiresLabel(iso: string): string {
  try {
    return `~${formatDistanceToNowStrict(parseISO(iso))}`;
  } catch {
    return '~2 hours';
  }
}

function ReadyDemo({ demo, compact, onRestart }: { demo: DemoSession; compact: boolean; onRestart: () => void }) {
  const isPhone = useMediaQuery('(max-width: 767px)');
  const frameable = demo.siteMeta?.frameable ?? false;
  const [tab, setTab] = useState<'desktop' | 'mobile'>('desktop');
  const [hintVisible, setHintVisible] = useState(true);

  const desktop = (
    <DeviceFrame device="desktop" url={demo.url} label="Your website on desktop with the chatbot" showScale={!compact}>
      <SiteSurface url={demo.url} siteMeta={demo.siteMeta} device="desktop" frameable={frameable} />
      <WidgetStage
        options={{ mode: 'floating', publicId: demo.publicId, channel: 'demo', open: true }}
        mountKey={['desktop', demo.publicId]}
      />
    </DeviceFrame>
  );
  const mobile = (
    <div className="relative" onPointerDownCapture={() => setHintVisible(false)}>
      <DeviceFrame device="mobile" url={demo.url} maxHeight={compact ? 620 : 720} label="Your website on mobile with the chatbot" showScale={!compact}>
        <SiteSurface url={demo.url} siteMeta={demo.siteMeta} device="mobile" frameable={frameable} />
        <WidgetStage
          options={{ mode: 'floating', publicId: demo.publicId, channel: 'demo', forceMobile: true, open: false }}
          mountKey={['mobile', demo.publicId]}
        />
        {hintVisible && (
          <div className="pointer-events-none absolute bottom-[104px] right-[22px] z-30 flex flex-col items-end" aria-hidden>
            <span className="rounded-full bg-slate-900 px-4 py-2 text-[15px] font-medium text-white shadow-xl">Tap to chat</span>
            <span className="mr-[18px] mt-2 h-4 w-4 animate-ping rounded-full bg-brand-500" />
          </div>
        )}
      </DeviceFrame>
    </div>
  );

  return (
    <div className="space-y-5" data-testid="demo-ready">
      <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200 sm:flex-row">
        <p className="flex items-center gap-2 text-slate-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          Trained on {demo.pagesProcessed} page{demo.pagesProcessed === 1 ? '' : 's'} from{' '}
          <span className="font-medium text-slate-900">{hostnameOf(demo.url)}</span>
        </p>
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock className="h-3.5 w-3.5" aria-hidden /> Demo expires in {expiresLabel(demo.expiresAt)} · limited to a few messages
        </p>
      </div>

      {isPhone ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'desktop' | 'mobile')}>
          <div className="flex justify-center">
            <TabsList>
              <TabsTrigger value="desktop">
                <Monitor aria-hidden /> Desktop
              </TabsTrigger>
              <TabsTrigger value="mobile">
                <Smartphone aria-hidden /> Mobile
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="desktop" className="min-w-0">
            {tab === 'desktop' && desktop}
          </TabsContent>
          <TabsContent value="mobile" className="min-w-0">
            {tab === 'mobile' && <div className="mx-auto w-full min-w-0 max-w-[340px]">{mobile}</div>}
          </TabsContent>
        </Tabs>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0" data-testid="demo-desktop">
            {desktop}
          </div>
          <div className="mx-auto w-full min-w-0 max-w-[360px]" data-testid="demo-mobile">
            {mobile}
          </div>
        </div>
      )}

      {!frameable && (
        <p className="mx-auto max-w-3xl text-center text-xs text-slate-500">
          Your site blocks embedding, so the page behind the widget is an approximation built from your content. The chat answers are real.
        </p>
      )}

      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" asChild className="shadow-md">
          <Link to={registerHref(demo.url)}>
            Create your chatbot for free <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button size="lg" variant="ghost" onClick={onRestart}>
          <RotateCcw aria-hidden /> Try another website
        </Button>
      </div>
    </div>
  );
}

function ExampleFrames({ compact }: { compact: boolean }) {
  return (
    <div className="min-w-0 space-y-3" data-testid="demo-example">
      <p className="flex justify-center">
        <span className="rounded-full bg-slate-900 px-3 py-1 text-center text-xs font-medium text-white shadow">
          Example — enter your URL to see your own site
        </span>
      </p>
      <div className="grid grid-cols-1 items-start gap-6 opacity-95 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]">
        <DeviceFrame device="desktop" url="sunrise-bakery.example" showScale={false} label="Example website on desktop">
          <SiteSurface url="https://sunrise-bakery.example" siteMeta={EXAMPLE_META} device="desktop" frameable={false} hideBanner />
          <ExampleChat device="desktop" />
        </DeviceFrame>
        <div className="mx-auto hidden w-full min-w-0 max-w-[300px] md:block">
          <DeviceFrame device="mobile" url="sunrise-bakery.example" showScale={false} maxHeight={compact ? 560 : 640} label="Example website on mobile">
            <SiteSurface url="https://sunrise-bakery.example" siteMeta={EXAMPLE_META} device="mobile" frameable={false} hideBanner />
            <ExampleChat device="mobile" />
          </DeviceFrame>
        </div>
      </div>
    </div>
  );
}

/** Static illustration of the widget for the example frame (not interactive). */
function ExampleChat({ device }: { device: 'desktop' | 'mobile' }) {
  const color = EXAMPLE_META.themeColor!;
  if (device === 'mobile') {
    return (
      <div className="absolute bottom-[34px] right-[22px] flex h-[60px] w-[60px] items-center justify-center rounded-full text-white shadow-xl" style={{ background: color }} aria-hidden>
        <Sparkles className="h-7 w-7" />
      </div>
    );
  }
  return (
    <div className="absolute bottom-[28px] right-[28px] w-[380px] overflow-hidden rounded-[20px] bg-white shadow-2xl ring-1 ring-black/5" aria-hidden>
      <div className="px-5 py-4 text-white" style={{ background: color }}>
        <p className="text-[17px] font-semibold">Sunrise Bakery</p>
        <p className="text-[13px] opacity-80">Typically replies instantly</p>
      </div>
      <div className="space-y-3 bg-slate-50 p-4 text-[15px]">
        <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 text-slate-700 shadow-sm">Hi! 👋 How can I help you today?</p>
        <p className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-white" style={{ background: color }}>
          Do you do gluten-free?
        </p>
        <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 text-slate-700 shadow-sm">
          Yes — we bake a gluten-free loaf every Friday. You can pre-order it online.
        </p>
      </div>
      <div className="border-t border-slate-100 px-4 py-3 text-[14px] text-slate-400">Type your message…</div>
    </div>
  );
}
