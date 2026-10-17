import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight,
  Eye,
  ExternalLink,
  Info,
  Layers,
  Loader2,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  KeyRound,
  RotateCcw,
  Save,
  Search,
  Smartphone,
  Tablet,
} from 'lucide-react';
import {
  buildEmbedCode,
  buildHostedUrl,
  type Chatbot,
  type ChatbotConfig,
  type PreviewChatReply,
  type WidgetInstance,
} from '@chatpilot/shared';
import { api, ApiError, errorMessage, isQuotaError } from '@/lib/api';
import { appConfig } from '@/lib/config';
import { qk } from '@/lib/queryKeys';
import { cn, hostnameOf, normalizeUrl } from '@/lib/utils';
import { useDebouncedValue, type UseWidgetMountOptions } from '@/lib/widget';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { QuotaNotice } from '@/components/QuotaNotice';
import { ColorField } from './ChatbotConfigForm';
import { DeviceFrame } from './DeviceFrame';
import { DEVICES, friendlyError, safeHref, useChatbot, useFrameCheck, withPreviewParam, withPreviewToken, type DeviceKind } from './lib';
import { SiteSurface } from './SiteSurface';
import { WidgetStage } from './WidgetStage';

export interface PreviewStudioProps {
  chatbot: Chatbot;
  /** Wizard: show a "Continue to publish" action. */
  onContinue?: () => void;
}

type Retrieved = NonNullable<PreviewChatReply['retrieved']>;
type QuickSettings = Pick<ChatbotConfig, 'primaryColor' | 'position' | 'welcomeMessage'>;

const DEVICE_ICONS: Record<DeviceKind, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function pickQuick(c: ChatbotConfig): QuickSettings {
  return { primaryColor: c.primaryColor, position: c.position, welcomeMessage: c.welcomeMessage };
}

export function PreviewStudio({ chatbot: initial, onContinue }: PreviewStudioProps) {
  const qc = useQueryClient();
  const { data: chatbot = initial } = useChatbot(initial.id, initial);
  const published = chatbot.status === 'published';

  const [urlInput, setUrlInput] = useState(chatbot.websiteUrl);
  const [url, setUrl] = useState(chatbot.websiteUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceKind>('desktop');
  const [mode, setMode] = useState<'draft' | 'published'>('draft');
  const [resetNonce, setResetNonce] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [retrieved, setRetrieved] = useState<{ question: string; items: Retrieved } | null>(null);
  const [lastError, setLastError] = useState<unknown>(null);
  const instanceRef = useRef<WidgetInstance | null>(null);

  // Quick appearance controls (live; saved on demand).
  const savedQuick = pickQuick(chatbot.config);
  const [quick, setQuick] = useState<QuickSettings>(savedQuick);
  const quickDirty = JSON.stringify(quick) !== JSON.stringify(savedQuick);
  const savedJson = JSON.stringify(savedQuick);
  useEffect(() => {
    if (!quickDirty) setQuick(JSON.parse(savedJson) as QuickSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedJson]);

  const draftConfig = useMemo<ChatbotConfig>(
    () => ({
      ...chatbot.config,
      primaryColor: HEX_RE.test(quick.primaryColor) ? quick.primaryColor : chatbot.config.primaryColor,
      position: quick.position,
      welcomeMessage: quick.welcomeMessage.trim() ? quick.welcomeMessage : chatbot.config.welcomeMessage,
    }),
    [chatbot.config, quick],
  );
  const liveConfig = useDebouncedValue(draftConfig, 150);
  const configRef = useRef(liveConfig);
  configRef.current = liveConfig;

  const sendPreview = useCallback(
    async (message: string, history: { role: 'user' | 'assistant'; content: string }[]) => {
      try {
        const reply = await api.post<PreviewChatReply>(`/chatbots/${encodeURIComponent(chatbot.id)}/preview/messages`, {
          message,
          history: history.slice(-20),
          config: configRef.current,
        });
        setRetrieved({ question: message, items: reply.retrieved ?? [] });
        setLastError(null);
        return { content: reply.message.content, sources: reply.message.sources, fallback: reply.message.fallback };
      } catch (e) {
        setLastError(e);
        throw e;
      }
    },
    [chatbot.id],
  );

  const frame = useFrameCheck(url);
  const frameable = frame.isLoading ? undefined : frame.data ? frame.data.frameable : (chatbot.siteMeta?.frameable ?? false);
  const blockReason = frame.data?.reason || chatbot.siteMeta?.frameBlockReason;

  const effectiveMode = published ? mode : 'draft';
  const widgetOptions: UseWidgetMountOptions =
    effectiveMode === 'published'
      ? { mode: 'floating', publicId: chatbot.publicId, channel: 'widget', forceMobile: device === 'mobile', open: device !== 'mobile' }
      : {
          mode: 'preview',
          config: liveConfig,
          sendPreview,
          forceMobile: device === 'mobile',
          open: device !== 'mobile',
          businessName: chatbot.businessName,
        };

  const saveQuick = useMutation({
    mutationFn: () => api.put<Chatbot>(`/chatbots/${encodeURIComponent(chatbot.id)}/config`, { ...chatbot.config, ...quick }),
    onSuccess: (c) => {
      qc.setQueryData(qk.chatbot(chatbot.id), c);
      toast.success('Appearance saved');
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save appearance.')),
  });

  const hostedUrl = buildHostedUrl(appConfig.appUrl, chatbot.publicId);

  const resetConversation = () => {
    setRetrieved(null);
    setLastError(null);
    if (instanceRef.current) {
      try {
        instanceRef.current.reset();
        return;
      } catch {
        /* fall back to remount */
      }
    }
    setResetNonce((n) => n + 1);
  };

  const commitUrl = () => {
    const n = normalizeUrl(urlInput);
    if (!n) {
      setUrlError('Enter a valid URL');
      return;
    }
    setUrlError(null);
    setUrlInput(n);
    setUrl(n);
  };

  return (
    <div className="space-y-6" data-testid="preview-studio">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 xl:flex-row xl:items-center">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            commitUrl();
          }}
        >
          <Label htmlFor="studio-url" className="sr-only">
            Page URL to preview
          </Label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              id="studio-url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="h-9 rounded-full pl-9"
              inputMode="url"
              aria-invalid={Boolean(urlError)}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Go
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Device">
            {(Object.keys(DEVICES) as DeviceKind[]).map((d) => {
              const Icon = DEVICE_ICONS[d];
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={device === d}
                  onClick={() => setDevice(d)}
                  title={`${DEVICES[d].label} (${DEVICES[d].width}×${DEVICES[d].height})`}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    device === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{DEVICES[d].label}</span>
                </button>
              );
            })}
          </div>

          <div className="inline-flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Configuration version">
            {(['draft', 'published'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={effectiveMode === m}
                disabled={m === 'published' && !published}
                title={m === 'published' && !published ? 'Publish your chatbot to preview the live version' : undefined}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm font-medium capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50',
                  effectiveMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
                )}
              >
                {m}
              </button>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={resetConversation}>
            <RotateCcw aria-hidden /> Reset chat
          </Button>
          {published ? (
            <Button variant="outline" size="sm" asChild>
              <a href={hostedUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink aria-hidden /> Hosted page
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled title="Available after publishing">
              <ExternalLink aria-hidden /> Hosted page
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
            aria-controls="studio-side-panel"
          >
            {panelOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
            <span className="hidden sm:inline">{panelOpen ? 'Hide tools' : 'Show tools'}</span>
          </Button>
        </div>
      </div>
      {urlError && (
        <p className="-mt-4 px-2 text-xs font-medium text-red-600" role="alert">
          {urlError}
        </p>
      )}

      <div className={cn('grid grid-cols-1 gap-6', panelOpen && 'xl:grid-cols-[minmax(0,1fr)_340px]')}>
        {/* Stage */}
        <div className="min-w-0 space-y-3">
          {frameable === false && (
            <Alert variant="warning">
              <Layers />
              <AlertTitle>Showing an approximation of {hostnameOf(url) || 'your site'}</AlertTitle>
              <AlertDescription>
                This site can't be displayed inside another page{blockReason ? ` (${blockReason})` : ''}. The page below is rebuilt from your
                site's content; the chat widget itself is the real one.
              </AlertDescription>
            </Alert>
          )}
          <div className="min-w-0 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-100 via-slate-50 to-brand-50 p-3 ring-1 ring-slate-200 sm:p-8">
            <DeviceFrame
              key={device}
              device={device}
              url={url}
              maxHeight={device === 'desktop' ? undefined : 780}
              onReload={frameable ? () => setReloadKey((k) => k + 1) : undefined}
            >
              <SiteSurface url={url} siteMeta={chatbot.siteMeta} device={device} frameable={frameable} reloadKey={reloadKey} />
              <WidgetStage
                options={widgetOptions}
                mountKey={[device, effectiveMode, resetNonce, chatbot.publicId]}
                onInstance={(i) => {
                  instanceRef.current = i;
                }}
              />
            </DeviceFrame>
          </div>
          <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              The widget is overlaid on top of the page in this preview — a page from another website can't be modified from here. On your site,
              the embed snippet adds the same widget directly.
              {effectiveMode === 'published'
                ? ' Published mode uses your live configuration: these are real conversations — they are stored, appear in your inbox and count toward your plan usage.'
                : ' Draft mode uses your unsaved settings; preview messages are not stored but count towards usage.'}
            </span>
          </p>
        </div>

        {/* Side panel */}
        {panelOpen && (
          <aside id="studio-side-panel" className="min-w-0 space-y-4">
            <Card className="rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quick appearance</CardTitle>
                <CardDescription>Changes apply to the draft preview instantly.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ColorField
                  id="studio-color"
                  value={quick.primaryColor}
                  onChange={(v) => setQuick((q) => ({ ...q, primaryColor: v }))}
                  brandColor={chatbot.siteMeta?.themeColor && HEX_RE.test(chatbot.siteMeta.themeColor) ? chatbot.siteMeta.themeColor.toUpperCase() : null}
                />
                <div className="space-y-2">
                  <Label id="studio-pos">Position</Label>
                  <div className="inline-flex rounded-lg bg-slate-100 p-1" role="group" aria-labelledby="studio-pos">
                    {(['left', 'right'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={quick.position === p}
                        onClick={() => setQuick((q) => ({ ...q, position: p }))}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                          quick.position === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="studio-welcome">Welcome message</Label>
                  <Textarea
                    id="studio-welcome"
                    rows={3}
                    maxLength={500}
                    value={quick.welcomeMessage}
                    onChange={(e) => setQuick((q) => ({ ...q, welcomeMessage: e.target.value }))}
                  />
                </div>
                {effectiveMode === 'published' && quickDirty && (
                  <p className="text-xs text-amber-700">Switch to Draft to see unsaved changes.</p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveQuick.mutate()}
                    disabled={!quickDirty || saveQuick.isPending || !quick.welcomeMessage.trim() || !HEX_RE.test(quick.primaryColor)}
                  >
                    {saveQuick.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save
                  </Button>
                  {quickDirty && (
                    <Button size="sm" variant="ghost" onClick={() => setQuick(savedQuick)}>
                      Discard
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {lastError != null && <PreviewError error={lastError} />}

            <Card className="rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye className="h-4 w-4 text-brand-600" aria-hidden /> Retrieved knowledge
                </CardTitle>
                <CardDescription>What the bot read before answering your last draft-preview question.</CardDescription>
              </CardHeader>
              <CardContent>
                {!retrieved ? (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                    Ask the bot something in the preview to inspect the sources it used.
                  </p>
                ) : retrieved.items.length === 0 ? (
                  <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-100">
                    Nothing relevant was found for “{retrieved.question}”. Consider adding an FAQ or manual content.
                  </p>
                ) : (
                  <div className="space-y-3" data-testid="retrieved-list">
                    <p className="text-xs text-slate-500">For “{retrieved.question}”</p>
                    <ol className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                      {retrieved.items.map((r, i) => (
                        <li key={`${r.url ?? ''}-${i}`} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-sm font-medium text-slate-800">{r.title || r.url || 'Manual content'}</p>
                            <Badge variant={r.score >= 0.75 ? 'success' : r.score >= 0.5 ? 'secondary' : 'warning'}>
                              {Math.round(Math.min(1, Math.max(0, r.score)) * 100)}%
                            </Badge>
                          </div>
                          {safeHref(r.url) && (
                            <a href={safeHref(r.url)} target="_blank" rel="noreferrer noopener" className="block truncate text-xs text-slate-500 hover:underline">
                              {r.url}
                            </a>
                          )}
                          <p className="mt-2 line-clamp-5 text-xs leading-relaxed text-slate-600">{r.excerpt}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        )}
      </div>

      <RealSitePreviewCard chatbot={chatbot} />

      {onContinue && (
        <div className="flex justify-end">
          <Button onClick={onContinue}>
            Continue to publish <ArrowRight aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function PreviewError({ error }: { error: unknown }) {
  if (isQuotaError(error)) return <QuotaNotice error={error} />;
  if (error instanceof ApiError && error.code === 'ai_unavailable') {
    return (
      <Alert variant="destructive">
        <AlertTitle>AI provider unavailable</AlertTitle>
        <AlertDescription>{error.message || 'The AI provider did not respond. Please try again in a minute.'}</AlertDescription>
      </Alert>
    );
  }
  const fe = friendlyError(error);
  return (
    <Alert variant="destructive">
      <AlertTitle>{fe.title}</AlertTitle>
      <AlertDescription>{fe.description}</AlertDescription>
    </Alert>
  );
}

function RealSitePreviewCard({ chatbot }: { chatbot: Chatbot }) {
  const qc = useQueryClient();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const rotate = useMutation({
    mutationFn: () => api.post<Chatbot>(`/chatbots/${encodeURIComponent(chatbot.id)}/preview-token/rotate`),
    onSuccess: (c) => {
      qc.setQueryData(qk.chatbot(chatbot.id), c);
      void qc.invalidateQueries({ queryKey: qk.chatbot(chatbot.id) });
      setConfirmRotate(false);
      toast.success('Preview token regenerated — old preview links and snippets no longer work');
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not regenerate the preview token.')),
  });
  const token = chatbot.previewToken;
  const snippet = token
    ? withPreviewToken(buildEmbedCode({ widgetUrl: appConfig.widgetUrl, publicId: chatbot.publicId, apiUrl: appConfig.apiUrl }), token)
    : '';
  const previewLink = token ? withPreviewParam(chatbot.websiteUrl, token) : '';
  const previewHref = safeHref(previewLink);
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Preview on your real site</CardTitle>
        <CardDescription>
          See your draft on your own website before going live. Only people with your private preview token see the draft — everyone else
          keeps seeing the published version (or nothing, if unpublished).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!token ? (
          <p className="text-sm text-slate-500">A preview token hasn't been issued for this chatbot yet. Save your configuration and reload.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <p className="text-sm font-medium text-slate-800">Snippet already installed?</p>
              <p className="text-xs text-slate-500">Open your site with this link to load the draft configuration:</p>
              <code className="block break-all rounded-lg bg-white p-3 font-mono text-xs text-slate-700 ring-1 ring-slate-200">{previewLink}</code>
              <div className="flex gap-2">
                <CopyButton value={previewLink} label="Copy link" />
                {previewHref && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={previewHref} target="_blank" rel="noreferrer noopener">
                      <ExternalLink aria-hidden /> Open
                    </a>
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <p className="text-sm font-medium text-slate-800">Not installed yet?</p>
              <p className="text-xs text-slate-500">
                Add this preview snippet to a staging page. It always shows the draft — remove it before launch and use the regular snippet.
              </p>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">{snippet}</pre>
              <CopyButton value={snippet} label="Copy preview snippet" />
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">Keep the preview token private. Anyone with it can view (not edit) your draft.</p>
          <Button size="sm" variant="outline" onClick={() => setConfirmRotate(true)} disabled={rotate.isPending}>
            <KeyRound aria-hidden /> Regenerate preview token
          </Button>
        </div>
      </CardContent>
      <Dialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate the preview token?</DialogTitle>
            <DialogDescription>
              Existing preview links and preview snippets stop working immediately. Your published widget and regular embed code are not
              affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRotate(false)}>
              Cancel
            </Button>
            <Button onClick={() => rotate.mutate()} disabled={rotate.isPending}>
              {rotate.isPending && <Loader2 className="animate-spin" aria-hidden />} Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
