import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, ExternalLink, Eye, FileText, MessageSquare, MoreHorizontal, Plus, Trash2, UserPlus } from 'lucide-react';
import type { Chatbot } from '@chatpilot/shared';
import { useChatbots, useMe } from '@/lib/hooks';
import { formatDate, formatNumber, hostnameOf, safeHref, safeImageSrc } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorState } from '@/components/ErrorState';
import { QuotaNotice } from '@/components/QuotaNotice';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChatbotStatusBadge } from '@/components/StatusBadge';
import { SiteIcon } from '@/components/SiteIcon';
import { useDeleteChatbot } from './useDeleteChatbot';
import { SafeExternalLink } from '@/components/SafeExternalLink';
import { useNavigate } from 'react-router-dom';

function ChatbotCard({ chatbot, onDelete }: { chatbot: Chatbot; onDelete: () => void }) {
  const navigate = useNavigate();
  const meta = chatbot.siteMeta;
  const stats = chatbot.stats;
  return (
    <Card className="group flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <Link
        to={`/app/chatbots/${chatbot.id}`}
        className="relative block h-28 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-50 focus-visible:outline-none"
        aria-label={`Open ${chatbot.name}`}
        tabIndex={-1}
      >
        {safeImageSrc(meta?.ogImage) ? (
          <img src={safeImageSrc(meta?.ogImage)} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" onError={(e) => (e.currentTarget.style.display = 'none')} />
        ) : (
          <div className="flex h-full items-center justify-center" style={{ background: `linear-gradient(135deg, ${chatbot.config.primaryColor}22, ${chatbot.config.primaryColor}08)` }}>
            <Bot className="h-8 w-8" style={{ color: chatbot.config.primaryColor }} aria-hidden="true" />
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <SiteIcon siteMeta={meta} className="-mt-10 h-12 w-12 shadow-sm" />
          <div className="min-w-0 flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-2 -mt-1 h-8 w-8" aria-label={`Actions for ${chatbot.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => navigate(`/app/chatbots/${chatbot.id}`)}>
                <FileText /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/app/chatbots/${chatbot.id}?tab=preview`)}>
                <Eye /> Preview
              </DropdownMenuItem>
              {safeHref(chatbot.websiteUrl) && (
                <DropdownMenuItem onSelect={() => window.open(safeHref(chatbot.websiteUrl), '_blank', 'noopener,noreferrer')}>
                  <ExternalLink /> Visit website
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-3 min-w-0">
          <Link to={`/app/chatbots/${chatbot.id}`} className="block truncate text-base font-semibold text-slate-900 hover:text-brand-700">
            {chatbot.name}
          </Link>
          <SafeExternalLink href={chatbot.websiteUrl} className="block truncate text-sm text-slate-500 hover:text-brand-600">
            {hostnameOf(chatbot.websiteUrl)}
          </SafeExternalLink>
        </div>
        <div className="mt-3">
          <ChatbotStatusBadge chatbot={chatbot} />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center">
          {[
            { label: 'Pages', value: stats?.sources ?? 0, icon: FileText },
            { label: 'Chats', value: stats?.conversations ?? 0, icon: MessageSquare },
            { label: 'Leads', value: stats?.leads ?? 0, icon: UserPlus },
          ].map((s) => (
            <div key={s.label}>
              <dt className="flex items-center justify-center gap-1 text-xs text-slate-500">
                <s.icon className="h-3 w-3" aria-hidden="true" /> {s.label}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{formatNumber(s.value)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-center gap-2">
          <Button asChild size="sm" className="flex-1">
            <Link to={`/app/chatbots/${chatbot.id}`}>Open</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="flex-1">
            <Link to={`/app/chatbots/${chatbot.id}?tab=preview`}>
              <Eye /> Preview
            </Link>
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-400">Updated {formatDate(chatbot.updatedAt)}</p>
      </div>
    </Card>
  );
}

export function ChatbotsListPage() {
  const chatbots = useChatbots();
  const me = useMe();
  const [toDelete, setToDelete] = useState<Chatbot | null>(null);
  const del = useDeleteChatbot({ onDeleted: () => setToDelete(null) });
  const [showQuota, setShowQuota] = useState(false);

  const items = chatbots.data?.items ?? [];
  const limit = me.data?.plan.limits.chatbots;
  const atLimit = typeof limit === 'number' && items.length >= limit;
  // A synthetic quota error so <QuotaNotice> renders the same notice the API would return.
  const quotaError =
    atLimit && me.data
      ? new ApiError({
          status: 402,
          code: 'quota_exceeded',
          message: 'Chatbot limit reached',
          details: { metric: 'chatbots', used: items.length, limit, resetAt: me.data.usage.resetAt, planId: me.data.plan.id },
        })
      : null;

  const createButton = atLimit ? (
    <Button onClick={() => setShowQuota(true)}>
      <Plus /> Create chatbot
    </Button>
  ) : (
    <Button asChild>
      <Link to="/app/chatbots/new">
        <Plus /> Create chatbot
      </Link>
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Chatbots"
        description={
          typeof limit === 'number' ? `${formatNumber(items.length)} of ${formatNumber(limit)} chatbots used on your plan.` : 'All the chatbots in your account.'
        }
        actions={createButton}
      />
      {showQuota && quotaError && <QuotaNotice error={quotaError} className="mb-6" />}

      {chatbots.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-xl" />
          ))}
        </div>
      ) : chatbots.isError ? (
        <ErrorState error={chatbots.error} title="Couldn't load your chatbots" onRetry={() => chatbots.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No chatbots yet"
          description="Enter your website URL and we'll build an assistant trained on your pages."
          action={
            <Button asChild size="lg">
              <Link to="/app/chatbots/new">
                <Plus /> Create your first chatbot
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <ChatbotCard key={c.id} chatbot={c} onDelete={() => setToDelete(c)} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name ?? 'chatbot'}?`}
        description="This permanently deletes the chatbot, its knowledge, conversations and leads. The widget will stop working on your website. This can't be undone."
        confirmLabel="Delete chatbot"
        loading={del.isPending}
        onConfirm={() => {
          if (toDelete) del.mutate(toDelete.id);
        }}
      />
    </div>
  );
}
