import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Code2,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Undo2,
} from 'lucide-react';
import { buildEmbedCode, buildHostedUrl, type Chatbot, type InstallStatus, type PublishResult } from '@chatpilot/shared';
import { api, errorMessage, isQuotaError } from '@/lib/api';
import { appConfig } from '@/lib/config';
import { qk } from '@/lib/queryKeys';
import { cn, formatDateTime } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QuotaNotice } from '@/components/QuotaNotice';
import { InstallDemo } from './InstallDemo';
import { useChatbot, useSourcesSummary } from './lib';

export interface PublishPanelProps {
  chatbot: Chatbot;
  /** True while the configuration form has unsaved edits (wizard). */
  hasUnsavedConfig?: boolean;
  /** Called after a successful publish. */
  onPublished?: (result: PublishResult) => void;
}

export function PublishPanel({ chatbot: initial, hasUnsavedConfig = false, onPublished }: PublishPanelProps) {
  const qc = useQueryClient();
  const { data: chatbot = initial } = useChatbot(initial.id, initial);
  const id = chatbot.id;
  const sources = useSourcesSummary(id);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  const isPublished = chatbot.status === 'published';
  const hasKnowledge = (sources.data?.items ?? []).some((s) => s.status === 'active');
  const checklist = [
    { ok: hasKnowledge, label: 'Knowledge base has active content', loading: sources.isLoading },
    { ok: Boolean(chatbot.config.welcomeMessage?.trim()), label: 'Welcome message is set' },
    { ok: !hasUnsavedConfig, label: 'Configuration is saved' },
  ];
  const ready = checklist.every((c) => c.ok);

  const publish = useMutation({
    mutationFn: () => api.post<PublishResult>(`/chatbots/${encodeURIComponent(id)}/publish`),
    onSuccess: (r) => {
      setResult(r);
      qc.setQueryData(qk.chatbot(id), r.chatbot);
      void qc.invalidateQueries({ queryKey: qk.chatbots() });
      void qc.invalidateQueries({ queryKey: qk.installStatus(id) });
      toast.success(r.version > 1 ? `Version ${r.version} is live` : 'Your chatbot is live');
      onPublished?.(r);
    },
  });

  const unpublish = useMutation({
    mutationFn: () => api.post<Chatbot>(`/chatbots/${encodeURIComponent(id)}/unpublish`),
    onSuccess: (c) => {
      setResult(null);
      setConfirmUnpublish(false);
      qc.setQueryData(qk.chatbot(id), c);
      void qc.invalidateQueries({ queryKey: qk.chatbots() });
      toast.success('Chatbot unpublished — the widget is now hidden on your site');
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not unpublish.')),
  });

  const install = useQuery({
    queryKey: qk.installStatus(id),
    queryFn: () => api.get<InstallStatus>(`/chatbots/${encodeURIComponent(id)}/install-status`),
    enabled: isPublished,
    staleTime: 30_000,
  });

  const embedCode =
    result?.embedCode ?? buildEmbedCode({ widgetUrl: appConfig.widgetUrl, publicId: chatbot.publicId, apiUrl: appConfig.apiUrl });
  const hostedUrl = result?.hostedUrl ?? buildHostedUrl(appConfig.appUrl, chatbot.publicId);

  return (
    <div className="space-y-6">
      {/* Status / publish */}
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-brand-600" aria-hidden /> Publish
            </CardTitle>
            <CardDescription>Publishing makes the current draft live on your website and hosted page.</CardDescription>
          </div>
          {isPublished ? (
            <Badge variant="success" data-testid="published-badge">
              <CheckCircle2 aria-hidden /> Published{chatbot.publishedVersion ? ` · v${chatbot.publishedVersion}` : ''} ✓
            </Badge>
          ) : (
            <Badge variant="secondary">{chatbot.status === 'unpublished' ? 'Unpublished' : 'Draft'}</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <ul className="space-y-2" aria-label="Pre-publish checklist">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-sm">
                {c.loading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden />
                ) : c.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 text-amber-500" aria-hidden />
                )}
                <span className={cn(c.ok ? 'text-slate-700' : 'text-slate-900 font-medium')}>{c.label}</span>
                <span className="sr-only">{c.ok ? '(done)' : '(to do)'}</span>
              </li>
            ))}
          </ul>

          {isPublished && chatbot.hasUnpublishedChanges && (
            <Alert variant="warning" data-testid="unpublished-changes">
              <AlertTriangle />
              <AlertTitle>Unpublished changes</AlertTitle>
              <AlertDescription>
                <p>Your draft differs from the live version. Republish to push the changes — your snippet stays the same.</p>
                <Button size="sm" className="mt-3" onClick={() => publish.mutate()} disabled={publish.isPending || !ready}>
                  {publish.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Republish
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {publish.isError &&
            (isQuotaError(publish.error) ? (
              <QuotaNotice error={publish.error} />
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Publishing failed</AlertTitle>
                <AlertDescription>{errorMessage(publish.error)}</AlertDescription>
              </Alert>
            ))}

          <div className="flex flex-wrap items-center gap-2">
            {!isPublished && (
              <Button size="lg" onClick={() => publish.mutate()} disabled={!ready || publish.isPending}>
                {publish.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
                {chatbot.status === 'unpublished' ? 'Publish again' : 'Publish chatbot'}
              </Button>
            )}
            {isPublished && !chatbot.hasUnpublishedChanges && (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Live{chatbot.publishedAt ? ` since ${formatDateTime(chatbot.publishedAt)}` : ''}. Future changes update without touching your snippet.
              </p>
            )}
            {isPublished && (
              <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmUnpublish(true)}>
                <Undo2 aria-hidden /> Unpublish
              </Button>
            )}
          </div>
          {!ready && !isPublished && <p className="text-xs text-slate-500">Complete the checklist above to publish.</p>}
        </CardContent>
      </Card>

      {isPublished && (
        <>
          {/* Embed code */}
          <Card className="rounded-2xl" data-testid="embed-card">
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Code2 className="h-5 w-5 text-brand-600" aria-hidden /> Embed code
                </CardTitle>
                <CardDescription>
                  Paste once before the closing <code>&lt;/body&gt;</code> tag. Updates you publish later take effect without changing it.
                </CardDescription>
              </div>
              <CopyButton value={embedCode} label="Copy code" variant="default" />
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-sm leading-relaxed text-slate-100" data-testid="embed-code">
                {embedCode}
              </pre>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Hosted link */}
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">Hosted chat page</CardTitle>
                <CardDescription>A full-page chat you can share on WhatsApp, Instagram bio, email signatures or QR codes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <code className="block break-all rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700 ring-1 ring-slate-200">{hostedUrl}</code>
                <div className="flex gap-2">
                  <CopyButton value={hostedUrl} label="Copy link" />
                  <Button size="sm" variant="outline" asChild>
                    <a href={hostedUrl} target="_blank" rel="noreferrer noopener">
                      <ExternalLink aria-hidden /> Open
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Install status */}
            <Card className="rounded-2xl">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Installation status</CardTitle>
                  <CardDescription>We detect the widget when it loads on your site.</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => install.refetch()} disabled={install.isFetching} aria-label="Check installation again">
                  <RefreshCw className={cn(install.isFetching && 'animate-spin')} aria-hidden /> Check
                </Button>
              </CardHeader>
              <CardContent>
                <InstallStatusLine status={install.data} loading={install.isLoading} error={install.error} />
              </CardContent>
            </Card>
          </div>

          <InstallInstructions embedCode={embedCode} config={chatbot.config} />
          <Troubleshooting />
        </>
      )}

      <Dialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpublish this chatbot?</DialogTitle>
            <DialogDescription>
              The widget will disappear from your website and the hosted page will stop working until you publish again. Your knowledge,
              settings, conversations and leads are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUnpublish(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => unpublish.mutate()} disabled={unpublish.isPending}>
              {unpublish.isPending && <Loader2 className="animate-spin" aria-hidden />} Unpublish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InstallStatusLine({ status, loading, error }: { status?: InstallStatus; loading: boolean; error: unknown }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking…
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-600">{errorMessage(error)}</p>;
  if (status?.lastSeenAt && status.lastSeenOrigin) {
    let ago = '';
    try {
      ago = formatDistanceToNow(parseISO(status.lastSeenAt), { addSuffix: true });
    } catch {
      ago = '';
    }
    return (
      <div className="space-y-2" data-testid="install-detected">
        <p className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Detected on <strong className="break-all">{status.lastSeenOrigin}</strong> {ago}
        </p>
        {status.allowedOrigins.length > 0 && (
          <p className="text-xs text-slate-500">Allowed origins: {status.allowedOrigins.join(', ')}</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1" data-testid="install-not-detected">
      <p className="flex items-center gap-2 text-sm text-slate-700">
        <Globe className="h-4 w-4 text-slate-400" aria-hidden /> Not detected yet
      </p>
      <p className="text-xs text-slate-500">Add the snippet to your site, open any page, then click “Check”.</p>
    </div>
  );
}

const PLATFORMS: { id: string; label: string; steps: (string | { code: true })[] }[] = [
  {
    id: 'html',
    label: 'Plain HTML',
    steps: [
      'Open the HTML file (or shared footer/layout template) used by every page.',
      'Paste the embed code just before the closing </body> tag:',
      { code: true },
      'Save and upload/deploy the file, then reload your site.',
    ],
  },
  {
    id: 'wordpress',
    label: 'WordPress',
    steps: [
      'Install a header/footer code plugin such as “WPCode” (Plugins → Add New).',
      'Go to Code Snippets → Header & Footer and paste the embed code in the Footer box.',
      'Save. If you use a caching plugin (WP Rocket, W3 Total Cache, LiteSpeed), purge the cache.',
      'Block themes: alternatively add a “Custom HTML” block in the footer template part (Appearance → Editor).',
    ],
  },
  {
    id: 'shopify',
    label: 'Shopify',
    steps: [
      'In Shopify admin open Online Store → Themes → ⋯ → Edit code.',
      'Open layout/theme.liquid.',
      'Paste the embed code just before </body> and click Save.',
      'Open your storefront (not the theme editor preview) to verify.',
    ],
  },
  {
    id: 'wix',
    label: 'Wix / Squarespace',
    steps: [
      'Wix: Settings → Custom Code → + Add Custom Code. Paste the code, apply to “All pages”, place in “Body – end”, and publish. (Requires a premium plan with a connected domain.)',
      'Squarespace: Settings → Advanced → Code Injection → Footer. Paste the code and save. (Requires a Business plan or higher.)',
    ],
  },
  {
    id: 'webflow',
    label: 'Webflow',
    steps: [
      'Open Site settings → Custom code.',
      'Paste the embed code into “Footer code” (before </body> tag) and save.',
      'Publish the site — custom code only runs on the published domain, not in the Designer.',
    ],
  },
  {
    id: 'gtm',
    label: 'Google Tag Manager',
    steps: [
      'In your GTM container click Tags → New → Tag configuration → Custom HTML.',
      'Paste the embed code.',
      'Triggering: choose “All Pages” (or “Initialization – All Pages”).',
      'Save, then Submit → Publish the container. Note: some consent/CSP setups block GTM-injected scripts.',
    ],
  },
  {
    id: 'react',
    label: 'React / Next.js / Vue',
    steps: [
      'Next.js (App Router): in app/layout.tsx import Script from "next/script" and render <Script src="…widget.js" data-chatbot-id="…" data-api-url="…" strategy="afterInteractive" /> inside <body>, using the values from the embed code.',
      'Next.js (Pages Router): add the same <Script> in pages/_app.tsx.',
      'Vite / CRA / Vue: paste the embed code before </body> in index.html.',
      'Load it once at the root — not inside a component that re-mounts on navigation.',
    ],
  },
];

function InstallInstructions({ embedCode, config }: { embedCode: string; config: Chatbot['config'] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Installation guides</CardTitle>
        <CardDescription>Pick your platform and watch the short walkthrough.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="html">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList className="w-max">
              {PLATFORMS.map((p) => (
                <TabsTrigger key={p.id} value={p.id}>
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {PLATFORMS.map((p) => (
            <TabsContent key={p.id} value={p.id} className="space-y-4">
              <InstallDemo
                platform={p.id}
                embedCode={embedCode}
                botName={config.botName}
                welcomeMessage={config.welcomeMessage}
                primaryColor={config.primaryColor}
              />
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 marker:text-slate-400">
                {p.steps.map((s, i) =>
                  typeof s === 'string' ? (
                    <li key={i}>{s}</li>
                  ) : (
                    <li key={i} className="list-none -ml-5">
                      <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-slate-100">{embedCode}</pre>
                    </li>
                  ),
                )}
              </ol>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function originOf(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return u;
  }
}

const TROUBLESHOOTING: { q: string; a: string }[] = [
  {
    q: 'The widget does not appear at all',
    a: 'Make sure the chatbot is published, the snippet is on the page you are viewing (View source → search for data-chatbot-id), and that you opened the live site rather than a page-builder preview.',
  },
  {
    q: 'Content Security Policy (CSP) blocks the script',
    a: `If your site sends a Content-Security-Policy header, add ${originOf(appConfig.widgetUrl)} to script-src and ${originOf(appConfig.apiUrl)} to connect-src (and img-src if you use an avatar image). The browser console shows "Refused to load the script" when this is the cause.`,
  },
  {
    q: 'Allowed origins mismatch',
    a: 'If you restricted allowed origins in settings, the exact origin (scheme + domain, e.g. https://www.example.com vs https://example.com) must be listed. Requests from other origins are refused.',
  },
  {
    q: 'Caching or optimisation plugins',
    a: 'Purge your site and CDN cache after adding the snippet. Plugins that delay or combine JavaScript (e.g. "Delay JS execution") may need the widget script excluded.',
  },
  {
    q: 'Ad blockers or privacy extensions',
    a: 'Some extensions block third-party chat widgets. Test in a private window without extensions to confirm.',
  },
];

function Troubleshooting() {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-5 w-5 text-slate-400" aria-hidden /> Troubleshooting
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-slate-100 rounded-xl border border-slate-200 p-0">
        {TROUBLESHOOTING.map((t) => (
          <details key={t.q} className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-800">
              {t.q}
              <span className="text-slate-400 transition-transform group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.a}</p>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}
