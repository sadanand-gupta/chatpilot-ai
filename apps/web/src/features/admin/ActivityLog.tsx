import { useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import type { ActivityEvent, ActivityEventType } from '@chatpilot/shared';
import { cn, formatDateTime, hostnameOf } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorState } from '@/components/ErrorState';
import { SafeExternalLink } from '@/components/SafeExternalLink';
import { describeUserAgent, EVENT_META, LoadMore, useAdminList } from './lib';

const ALL = '__all__';

export function EventLabel({ type }: { type: ActivityEventType }) {
  const meta = EVENT_META[type];
  if (!meta) return <span className="text-sm text-slate-700">{type}</span>;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-800">
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', meta.tone)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      {meta.label}
    </span>
  );
}

export function EventWho({ e }: { e: ActivityEvent }) {
  if (e.uid && e.email) {
    return (
      <Link to={`/app/admin/users/${encodeURIComponent(e.uid)}`} className="text-brand-600 hover:underline">
        {e.email}
      </Link>
    );
  }
  if (e.email) return <span>{e.email}</span>;
  return <span className="text-slate-400">Anonymous visitor</span>;
}

function DemoStatus({ status }: { status?: string }) {
  if (status === 'ready') return <Badge variant="success">Ready</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  if (status === 'crawling') return <Badge variant="warning">Reading site…</Badge>;
  return null;
}

function EventDetails({ e }: { e: ActivityEvent }) {
  return (
    <div className="max-w-xs space-y-1">
      {(e.url || e.chatbotName) && (
        <p className="truncate text-sm text-slate-800">
          {e.chatbotName && <span className="font-medium">{e.chatbotName}</span>}
          {e.chatbotName && e.url && <span className="text-slate-400"> · </span>}
          {e.url && (
            <SafeExternalLink href={e.url} className="text-slate-600 hover:text-brand-600 hover:underline" title={e.url}>
              {hostnameOf(e.url)}
            </SafeExternalLink>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        {e.type === 'demo_started' && <DemoStatus status={e.status} />}
        {e.type === 'demo_started' && <span>{e.messages ?? 0} messages</span>}
        {e.detail && <span className="line-clamp-2" title={e.detail}>{e.detail}</span>}
        {e.actorEmail && <span>by {e.actorEmail}</span>}
      </div>
    </div>
  );
}

/** Platform audit log. With `uid`, shows one account's history. */
export function ActivityLog({ uid }: { uid?: string }) {
  const [type, setType] = useState('');
  const list = useAdminList<ActivityEvent>('activity', { type: type || undefined, uid });
  const cols = uid ? 4 : 5;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Select value={type || ALL} onValueChange={(v) => setType(v === ALL ? '' : v)}>
          <SelectTrigger className="w-full sm:w-60" aria-label="Filter by event">
            <SelectValue placeholder="All events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All events</SelectItem>
            {(Object.keys(EVENT_META) as ActivityEventType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {EVENT_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} title="Couldn't load activity" onRetry={() => list.refetch()} />
      ) : !list.isLoading && list.items.length === 0 ? (
        <EmptyState icon={History} title="No activity yet" description="Sign-ins, demo attempts and chatbot changes are recorded here as they happen." />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                {!uid && <TableHead>Who</TableHead>}
                <TableHead className="min-w-[200px]">Website / details</TableHead>
                <TableHead>IP · device</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: cols }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : list.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time>
                      </TableCell>
                      <TableCell>
                        <EventLabel type={e.type} />
                      </TableCell>
                      {!uid && (
                        <TableCell className="whitespace-nowrap text-sm">
                          <EventWho e={e} />
                        </TableCell>
                      )}
                      <TableCell>
                        <EventDetails e={e} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        <p className="font-mono">{e.ip || '—'}</p>
                        {e.userAgent && (
                          <p title={e.userAgent} className="mt-0.5">
                            {describeUserAgent(e.userAgent)}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          <LoadMore list={list} />
        </Card>
      )}
    </div>
  );
}
