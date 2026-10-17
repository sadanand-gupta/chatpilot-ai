import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Lock, MessageSquare, Search, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Lead, Paginated } from '@chatpilot/shared';
import { ApiError, api, errorMessage, qs } from '@/lib/api';
import { qk, type LeadFilters } from '@/lib/queryKeys';
import { useChatbots, useMe } from '@/lib/hooks';
import { useDebounced } from '@/lib/useDebounced';
import { cn, formatDateTime, hostnameOf } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ErrorState } from '@/components/ErrorState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SafeExternalLink } from '@/components/SafeExternalLink';
import { ChatbotFilter } from '@/components/ChatbotFilter';
import { QuotaNotice } from '@/components/QuotaNotice';

const PAGE_SIZE = 25;

function CsvUpgradeNotice({ onClose }: { onClose: () => void }) {
  return (
    <Alert variant="warning" className="pr-10">
      <Lock />
      <AlertTitle>CSV export isn't included in your plan</AlertTitle>
      <AlertDescription>
        <p>Upgrade to a plan with CSV export to download your leads as a spreadsheet.</p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/app/billing">See plans</Link>
        </Button>
      </AlertDescription>
      <button type="button" onClick={onClose} className="absolute right-3 top-3 cursor-pointer rounded p-1 text-amber-700 hover:bg-amber-100" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </Alert>
  );
}

export function LeadsTable({ fixedChatbotId }: { fixedChatbotId?: string }) {
  const [params, setParams] = useSearchParams();
  const chatbotId = fixedChatbotId ?? params.get('chatbotId') ?? '';
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 350);
  const [toDelete, setToDelete] = useState<Lead | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const queryClient = useQueryClient();
  const me = useMe();
  const chatbots = useChatbots();
  const names = useMemo(() => new Map(chatbots.data?.items.map((c) => [c.id, c.name]) ?? []), [chatbots.data]);
  const canExport = me.data ? me.data.plan.features.csvExport : true;

  const filters: LeadFilters = { chatbotId: chatbotId || undefined, q: q || undefined };
  const list = useInfiniteQuery({
    queryKey: qk.leads(filters),
    initialPageParam: '' as string,
    queryFn: ({ pageParam, signal }) =>
      api.get<Paginated<Lead>>(`/leads${qs({ ...filters, limit: PAGE_SIZE, cursor: pageParam || undefined })}`, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/leads/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success('Lead deleted');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setToDelete(null);
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not delete the lead')),
  });

  async function exportCsv() {
    setExportError(null);
    if (!canExport) {
      setShowUpgrade(true);
      return;
    }
    setExporting(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await api.download(`/leads/export.csv${qs({ chatbotId: chatbotId || undefined })}`, `leads-${date}.csv`);
      toast.success('Leads exported');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 403) && e.code !== 'quota_exceeded') setShowUpgrade(true);
      else if (e instanceof ApiError && e.code === 'quota_exceeded') setExportError(e);
      else toast.error(errorMessage(e, 'Export failed'));
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = Boolean(q || (!fixedChatbotId && chatbotId));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Label htmlFor="lead-search" className="sr-only">
            Search leads
          </Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input id="lead-search" placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {!fixedChatbotId && (
          <ChatbotFilter
            value={chatbotId}
            onChange={(v) =>
              setParams(
                (prev) => {
                  const n = new URLSearchParams(prev);
                  if (v) n.set('chatbotId', v);
                  else n.delete('chatbotId');
                  return n;
                },
                { replace: true },
              )
            }
          />
        )}
        <Button variant="outline" onClick={exportCsv} disabled={exporting || items.length === 0}>
          {canExport ? <Download /> : <Lock />} {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </div>

      {showUpgrade && <CsvUpgradeNotice onClose={() => setShowUpgrade(false)} />}
      <QuotaNotice error={exportError} />

      {list.isError ? (
        <ErrorState error={list.error} title="Couldn't load leads" onRetry={() => list.refetch()} />
      ) : !list.isLoading && items.length === 0 ? (
        <EmptyState
          icon={hasFilters ? Search : UserPlus}
          title={hasFilters ? 'No leads match your filters' : 'No leads yet'}
          description={
            hasFilters
              ? 'Try a different search.'
              : 'Turn on lead capture in your chatbot settings. When visitors leave their details, they appear here.'
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="min-w-[200px]">Message</TableHead>
                {!fixedChatbotId && <TableHead>Chatbot</TableHead>}
                <TableHead>Consent</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: fixedChatbotId ? 7 : 8 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : items.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium text-slate-900">{l.name || <span className="text-slate-400">—</span>}</TableCell>
                      <TableCell>
                        {l.email ? (
                          <a href={`mailto:${l.email}`} className="text-brand-600 hover:underline">
                            {l.email}
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {l.phone ? (
                          <a href={`tel:${l.phone.replace(/[^+\d]/g, '')}`} className="hover:underline">
                            {l.phone}
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="line-clamp-2 max-w-xs text-sm" title={l.message}>
                          {l.message || <span className="text-slate-400">—</span>}
                        </p>
                        {l.pageUrl && (
                          <SafeExternalLink href={l.pageUrl} className="mt-0.5 block max-w-xs truncate text-xs text-slate-500 hover:text-brand-600" title={l.pageUrl}>
                            from {hostnameOf(l.pageUrl)}
                          </SafeExternalLink>
                        )}
                      </TableCell>
                      {!fixedChatbotId && (
                        <TableCell className="whitespace-nowrap">
                          <Link to={`/app/chatbots/${l.chatbotId}`} className="hover:text-brand-600 hover:underline">
                            {names.get(l.chatbotId) ?? 'Chatbot'}
                          </Link>
                        </TableCell>
                      )}
                      <TableCell>
                        {l.consent ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Given
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">No</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(l.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {l.conversationId && (
                            <SimpleTooltip content="Open conversation">
                              <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                                <Link to={`/app/conversations?conversation=${encodeURIComponent(l.conversationId)}`} aria-label="Open conversation">
                                  <MessageSquare />
                                </Link>
                              </Button>
                            </SimpleTooltip>
                          )}
                          <SimpleTooltip content="Delete lead">
                            <Button variant="ghost" size="icon" className={cn('h-8 w-8 text-slate-500 hover:text-red-600')} onClick={() => setToDelete(l)} aria-label="Delete lead">
                              <Trash2 />
                            </Button>
                          </SimpleTooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {list.hasNextPage && (
            <div className="border-t border-slate-100 p-3 text-center">
              <Button variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this lead?"
        description={`${toDelete?.name || toDelete?.email || 'This lead'} will be permanently removed. This can't be undone.`}
        confirmLabel="Delete lead"
        loading={del.isPending}
        onConfirm={() => {
          if (toDelete) del.mutate(toDelete.id);
        }}
      />
    </div>
  );
}
