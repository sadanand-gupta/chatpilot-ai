import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format, isValid, parseISO } from 'date-fns';
import { Bot, FlaskConical, MessageSquare, UserCheck, UserPlus, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import type { AdminDailyPoint, AdminOverview as Overview } from '@chatpilot/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatNumber } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ErrorState';
import { StatCard } from '@/features/dashboard/DashboardPage';
import { EventLabel, EventWho } from './ActivityLog';

/** Fixed categorical order (validated: CVD-separable on white). */
const SERIES = [
  { key: 'signIns', label: 'Sign-ins', color: '#2a78d6' },
  { key: 'signUps', label: 'Sign-ups', color: '#eb6834' },
  { key: 'demos', label: 'Demo attempts', color: '#1baf7a' },
] as const satisfies readonly { key: keyof AdminDailyPoint; label: string; color: string }[];

function dayLabel(date: string, pattern: string) {
  const d = parseISO(date);
  return isValid(d) ? format(d, pattern) : date;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as AdminDailyPoint;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-slate-500">{dayLabel(point.date, 'EEE, MMM d')}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="mt-1 flex items-center gap-1.5 text-slate-700">
          <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
          {s.label}: <span className="font-semibold text-slate-900">{formatNumber(point[s.key])}</span>
        </p>
      ))}
    </div>
  );
}

function DailyChart({ daily }: { daily: AdminDailyPoint[] }) {
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            {s.label} <span className="font-semibold tabular-nums text-slate-900">{formatNumber(daily.reduce((n, d) => n + d[s.key], 0))}</span>
          </li>
        ))}
      </ul>
      <figure className="h-64 w-full" aria-label="Sign-ins, sign-ups and demo attempts per day, last 14 days">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="#eef2f7" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(d: string) => dayLabel(d, 'MMM d')}
              minTickGap={16}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={40} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </figure>
    </div>
  );
}

export function AdminOverview() {
  const q = useQuery({
    queryKey: qk.admin('overview'),
    queryFn: ({ signal }) => api.get<Overview>('/admin/overview', { signal }),
  });

  if (q.isError) return <ErrorState error={q.error} title="Couldn't load the overview" onRetry={() => q.refetch()} />;
  const t = q.data?.totals;
  const n = (v: number | undefined) => (v === undefined ? '…' : formatNumber(v));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Users" value={n(t?.users)} icon={Users} hint={t && `${formatNumber(t.newUsers7d)} new in the last 7 days`} />
        <StatCard label="Active users (7 days)" value={n(t?.activeUsers7d)} icon={UserCheck} hint="Signed in or used the dashboard" />
        <StatCard label="Demo attempts (7 days)" value={n(t?.demos7d)} icon={FlaskConical} hint="Visitors who tried the landing-page demo" />
        <StatCard label="Chatbots" value={n(t?.chatbots)} icon={Bot} hint={t && `${formatNumber(t.publishedChatbots)} published`} />
        <StatCard label="Conversations" value={n(t?.conversations)} icon={MessageSquare} hint="All chatbots, all time" />
        <StatCard label="Leads" value={n(t?.leads)} icon={UserPlus} hint="Collected by all chatbots" />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="min-w-0 xl:col-span-3">
          <CardHeader>
            <CardTitle>Last 14 days</CardTitle>
            <CardDescription>Daily sign-ins, new accounts and landing-page demo attempts (UTC).</CardDescription>
          </CardHeader>
          <CardContent>{q.data ? <DailyChart daily={q.data.daily} /> : <Skeleton className="h-64 w-full" />}</CardContent>
        </Card>
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader>
            <CardTitle>Latest activity</CardTitle>
            <CardDescription>What's happening across the platform right now.</CardDescription>
          </CardHeader>
          <CardContent>
            {!q.data ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : q.data.recentActivity.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No activity recorded yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {q.data.recentActivity.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <EventLabel type={e.type} />
                      <p className="ml-9 mt-0.5 truncate text-xs text-slate-500">
                        <EventWho e={e} />
                        {e.url && <span title={e.url}> · {e.chatbotName || e.url}</span>}
                      </p>
                    </div>
                    <time dateTime={e.createdAt} className="shrink-0 text-xs text-slate-400">
                      {formatDistanceToNow(parseISO(e.createdAt), { addSuffix: true })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
