import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { ArrowLeft, Bot, ExternalLink, Inbox, Link2, MessageSquare, Search, Trash2, User, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage, Conversation, Conversations, Paginated } from '@chatpilot/shared';
import { api, errorMessage, qs } from '@/lib/api';
import { qk, type ConversationFilters } from '@/lib/queryKeys';
import { useChatbots } from '@/lib/hooks';
import { dayBoundaryIso, useDebounced } from '@/lib/useDebounced';
import { cn, formatDateTime, hostnameOf, safeHref } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ErrorState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChannelBadge } from '@/components/StatusBadge';
import { ChatbotFilter } from '@/components/ChatbotFilter';
import { SafeExternalLink } from '@/components/SafeExternalLink';

const PAGE_SIZE = 25;

function relative(iso: string) {
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

function ConversationListItem({ c, active, chatbotName, onSelect }: { c: Conversation; active: boolean; chatbotName?: string; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'w-full cursor-pointer border-l-2 px-4 py-3 text-left transition-colors focus-visible:bg-slate-50 focus-visible:outline-none',
          active ? 'border-brand-600 bg-brand-50/60' : 'border-transparent hover:bg-slate-50',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-slate-900">Visitor {c.visitorId.slice(-6)}</span>
          <time className="shrink-0 text-xs text-slate-400" dateTime={c.lastMessageAt}>
            {relative(c.lastMessageAt)}
          </time>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{c.lastMessagePreview || 'No messages'}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {chatbotName && <span className="truncate text-xs text-slate-500">{chatbotName}</span>}
          <span className="text-xs text-slate-400">· {c.messageCount} msgs</span>
          {c.hasLead && (
            <Badge variant="success" className="px-1.5 py-0">
              <UserPlus /> Lead
            </Badge>
          )}
        </div>
      </button>
    </li>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === 'user';
  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-slate-200 text-slate-600' : 'bg-brand-100 text-brand-700',
        )}
        aria-hidden="true"
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </span>
      <div className={cn('flex max-w-[85%] flex-col sm:max-w-[75%]', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
            isUser ? 'rounded-tr-sm bg-brand-600 text-white' : 'rounded-tl-sm bg-slate-100 text-slate-800',
            m.fallback && 'ring-1 ring-amber-300',
          )}
        >
          {m.content}
        </div>
        {!isUser && m.sources && m.sources.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {m.sources.slice(0, 4).map((s, i) =>
              safeHref(s.url) ? (
                <SafeExternalLink
                  key={i}
                  href={s.url}
                  className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-brand-200 hover:text-brand-700"
                >
                  <Link2 className="h-3 w-3 shrink-0" /> <span className="truncate">{s.title || hostnameOf(s.url)}</span>
                </SafeExternalLink>
              ) : (
                <span key={i} className="inline-flex max-w-[220px] items-center truncate rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
                  {s.title || s.url}
                </span>
              ),
            )}
          </div>
        )}
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
          <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
          {m.fallback && <span className="text-amber-600">· fallback answer</span>}
        </span>
      </div>
    </div>
  );
}

function ConversationThread({ id, chatbotName, onBack, onDeleted }: { id: string; chatbotName?: string; onBack: () => void; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({
    queryKey: qk.conversation(id),
    queryFn: ({ signal }) => api.get<Conversations>(`/conversations/${encodeURIComponent(id)}`, { signal }),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/conversations/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success('Conversation deleted');
      queryClient.removeQueries({ queryKey: qk.conversation(id) });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirm(false);
      onDeleted();
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete the conversation')),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
        <Skeleton className="h-20 w-3/4 rounded-2xl" />
        <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
      </div>
    );
  }
  if (q.isError || !q.data) return <ErrorState className="m-5" error={q.error} title="Couldn't load this conversation" onRetry={() => q.refetch()} />;

  const { conversation: c, messages } = q.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-slate-900">Visitor {c.visitorId.slice(-6)}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <ChannelBadge channel={c.channel} />
            {c.hasLead && (
              <Link to={`/app/leads?chatbotId=${c.chatbotId}`}>
                <Badge variant="success">
                  <UserPlus /> Lead captured
                </Badge>
              </Link>
            )}
            {chatbotName && <span>{chatbotName}</span>}
            <span>· Started {formatDateTime(c.createdAt)}</span>
          </div>
          {c.pageUrl && (
            <SafeExternalLink
              href={c.pageUrl}
              className={cn('mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs', safeHref(c.pageUrl) ? 'text-brand-600 hover:underline' : 'text-slate-500')}
            >
              <ExternalLink className="h-3 w-3 shrink-0" /> <span className="truncate">{c.pageUrl}</span>
            </SafeExternalLink>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setConfirm(true)} aria-label="Delete conversation" className="text-slate-500 hover:text-red-600">
          <Trash2 />
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5" aria-label="Messages">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">This conversation has no messages.</p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this conversation?"
        description="The conversation and all its messages will be permanently deleted. Leads captured in it are kept."
        confirmLabel="Delete conversation"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}

export function ConversationsInbox({ fixedChatbotId, className }: { fixedChatbotId?: string; className?: string }) {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('conversation') ?? '';
  const chatbotId = fixedChatbotId ?? params.get('chatbotId') ?? '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 350);
  const chatbots = useChatbots();
  const names = useMemo(() => new Map(chatbots.data?.items.map((c) => [c.id, c.name]) ?? []), [chatbots.data]);

  const filters: ConversationFilters = {
    chatbotId: chatbotId || undefined,
    from: dayBoundaryIso(from, 'start'),
    to: dayBoundaryIso(to, 'end'),
    q: q || undefined,
  };

  const list = useInfiniteQuery({
    queryKey: qk.conversations(filters),
    initialPageParam: '' as string,
    queryFn: ({ pageParam, signal }) =>
      api.get<Paginated<Conversation>>(`/conversations${qs({ ...filters, limit: PAGE_SIZE, cursor: pageParam || undefined })}`, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const hasFilters = Boolean(from || to || q || (!fixedChatbotId && chatbotId));

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="relative flex-1 sm:min-w-[220px]">
          <Label htmlFor="conv-search" className="sr-only">
            Search conversations
          </Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input id="conv-search" placeholder="Search messages…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {!fixedChatbotId && <ChatbotFilter value={chatbotId} onChange={(v) => update({ chatbotId: v || null, conversation: null })} />}
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="conv-from" className="mb-1 block text-xs text-slate-500">
              From
            </Label>
            <Input id="conv-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="sm:w-40" />
          </div>
          <div className="flex-1">
            <Label htmlFor="conv-to" className="mb-1 block text-xs text-slate-500">
              To
            </Label>
            <Input id="conv-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="sm:w-40" />
          </div>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setFrom('');
              setTo('');
              setSearch('');
              if (!fixedChatbotId) update({ chatbotId: null });
            }}
          >
            <X /> Clear
          </Button>
        )}
      </div>

      {list.isError ? (
        <ErrorState error={list.error} title="Couldn't load conversations" onRetry={() => list.refetch()} />
      ) : !list.isLoading && items.length === 0 ? (
        <EmptyState
          icon={hasFilters ? Search : Inbox}
          title={hasFilters ? 'No conversations match your filters' : 'No conversations yet'}
          description={
            hasFilters
              ? 'Try a different search or date range.'
              : 'When visitors chat with your published chatbot, their conversations appear here.'
          }
        />
      ) : (
        <Card className="grid h-[calc(100dvh-16rem)] min-h-[480px] overflow-hidden lg:grid-cols-[360px_1fr]">
          <div className={cn('flex min-h-0 flex-col border-slate-200 lg:border-r', selectedId && 'hidden lg:flex')}>
            <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto" aria-label="Conversations">
              {list.isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <li key={i} className="space-y-2 px-4 py-3">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-full" />
                    </li>
                  ))
                : items.map((c) => (
                    <ConversationListItem
                      key={c.id}
                      c={c}
                      active={c.id === selectedId}
                      chatbotName={fixedChatbotId ? undefined : names.get(c.chatbotId)}
                      onSelect={() => update({ conversation: c.id })}
                    />
                  ))}
            </ul>
            {list.hasNextPage && (
              <div className="border-t border-slate-100 p-3">
                <Button variant="outline" size="sm" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </div>
          <div className={cn('min-h-0', !selectedId && 'hidden lg:block')}>
            {selectedId ? (
              <ConversationThread
                key={selectedId}
                id={selectedId}
                chatbotName={names.get(items.find((i) => i.id === selectedId)?.chatbotId ?? '')}
                onBack={() => update({ conversation: null })}
                onDeleted={() => update({ conversation: null })}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <MessageSquare className="mb-3 h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">Select a conversation</p>
                <p className="mt-1 text-xs text-slate-500">Pick a conversation on the left to read the full thread.</p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
