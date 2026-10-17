import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MessageCircleOff, RefreshCw } from 'lucide-react';
import type { PublicChatbotConfig } from '@chatpilot/shared';
import { ApiError, publicApi } from '@/lib/api';
import { appConfig } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { studioKeys } from '@/features/studio/lib';
import { WidgetStage } from '@/features/studio/WidgetStage';

/** Sets/creates a <meta name=...> tag and returns a restore function. */
function setMeta(name: string, content: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  const created = !el;
  const previous = el?.getAttribute('content') ?? null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (created) el?.remove();
    else if (previous !== null) el?.setAttribute('content', previous);
  };
}

/**
 * Public, full-viewport hosted chat page: /chat/:publicId
 * Shows only the published, public config — no dashboard links or private data.
 */
export function HostedChatPage() {
  const { publicId = '' } = useParams<{ publicId: string }>();
  const q = useQuery({
    queryKey: studioKeys.publicConfig(publicId),
    queryFn: () => publicApi.get<PublicChatbotConfig>(`/public/chatbots/${encodeURIComponent(publicId)}/config`),
    enabled: Boolean(publicId),
    retry: (count, e) => !(e instanceof ApiError && (e.status === 404 || e.code === 'not_found' || e.code === 'not_published')) && count < 2,
    staleTime: 60_000,
  });
  const data = q.data;

  useEffect(() => {
    if (!data) return;
    const prevTitle = document.title;
    document.title = `Chat with ${data.businessName}`;
    const restoreDesc = setMeta(
      'description',
      `Ask ${data.businessName} anything — get instant answers from their AI assistant.`,
    );
    const restoreTheme = setMeta('theme-color', data.config.primaryColor);
    return () => {
      document.title = prevTitle;
      restoreDesc();
      restoreTheme();
    };
  }, [data]);

  if (!publicId || q.isError) {
    const e = q.error;
    const kind =
      e instanceof ApiError && e.code === 'not_published'
        ? 'not_published'
        : e instanceof ApiError && (e.status === 404 || e.code === 'not_found')
          ? 'not_found'
          : 'error';
    return <HostedUnavailable kind={!publicId ? 'not_found' : kind} onRetry={() => q.refetch()} />;
  }

  if (q.isLoading || !data) {
    return (
      <div className="flex h-[100dvh] flex-col bg-slate-50" aria-busy="true" data-testid="hosted-loading">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4">
          <Skeleton className="h-16 w-3/4 rounded-2xl" />
          <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
          <Skeleton className="h-20 w-2/3 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-50">
      <h1 className="sr-only">Chat with {data.businessName}</h1>

      <main className="relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <WidgetStage
          layout="fill"
          options={{ mode: 'fullpage', publicId, channel: 'hosted', businessName: data.businessName }}
          mountKey={[publicId]}
        />
      </main>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-[11px] leading-snug text-slate-500">
        Messages are processed by AI and stored by {data.businessName}. Don't share sensitive information.{' '}
        <Link to="/privacy" className="underline hover:text-slate-700">
          Privacy
        </Link>
      </footer>
    </div>
  );
}

function HostedUnavailable({ kind, onRetry }: { kind: 'not_published' | 'not_found' | 'error'; onRetry: () => void }) {
  const copy = {
    not_published: {
      title: 'This chat is not available right now',
      body: "The business hasn't published its assistant yet, or has paused it. Please check back later or contact them directly.",
    },
    not_found: {
      title: 'Chat not found',
      body: 'This link may be mistyped or the chat may have been removed.',
    },
    error: {
      title: 'Something went wrong',
      body: "We couldn't load this chat. Check your connection and try again.",
    },
  }[kind];
  useEffect(() => {
    const prev = document.title;
    document.title = `${copy.title} · ${appConfig.productName}`;
    return () => {
      document.title = prev;
    };
  }, [copy.title]);
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4" data-testid={`hosted-${kind}`}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <MessageCircleOff className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-500">{copy.body}</p>
        {kind === 'error' && (
          <Button className="mt-5" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        )}
        <p className="mt-6 text-xs text-slate-400">Powered by {appConfig.productName}</p>
      </div>
    </div>
  );
}
