import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  ArrowRight,
  Bot,
  Eye,
  FileSearch,
  Globe,
  MessageSquare,
  Plus,
  Rocket,
  Settings2,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityItem, DashboardStats } from '@chatpilot/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useAuth } from '@/lib/auth';
import { useChatbots } from '@/lib/hooks';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { ErrorState } from '@/components/ErrorState';
import { ConversationsChart } from './ConversationsChart';

const RANGES = [7, 30, 90] as const;

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  to,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: React.ReactNode;
  to?: string;
}) {
  const body = (
    <Card className={cn('h-full p-5 transition-shadow', to && 'hover:border-brand-200 hover:shadow-md')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900" data-testid={`stat-${label}`}>
            {value}
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      {hint && <div className="mt-3 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      {body}
    </Link>
  ) : (
    body
  );
}

const ACTIVITY_ICON: Record<ActivityItem['type'], LucideIcon> = {
  conversation: MessageSquare,
  lead: UserPlus,
  crawl: FileSearch,
  publish: Rocket,
  chatbot_created: Sparkles,
};

function ActivityList({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return <p className="py-8 text-center text-sm text-slate-500">No activity yet. It will show up here as visitors chat and leads arrive.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {items.slice(0, 8).map((a, i) => {
        const Icon = ACTIVITY_ICON[a.type] ?? MessageSquare;
        return (
          <li key={`${a.at}-${i}`} className="flex items-start gap-3 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800">{a.message}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                <Link to={`/app/chatbots/${a.chatbotId}`} className="font-medium hover:text-brand-600 hover:underline">
                  {a.chatbotName}
                </Link>{' '}
                · <time dateTime={a.at}>{formatDistanceToNow(parseISO(a.at), { addSuffix: true })}</time>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500">
          {formatNumber(used)} / {formatNumber(limit)}
        </span>
      </div>
      <Progress value={pct} aria-label={`${label} usage`} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

function FirstChatbotEmptyState() {
  const steps = [
    { icon: Globe, title: 'Enter your website', text: 'We read your public pages.' },
    { icon: Settings2, title: 'Review & customize', text: 'Check knowledge, pick colours.' },
    { icon: Rocket, title: 'Publish & install', text: 'Paste one line of code.' },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="relative bg-gradient-to-br from-brand-600 via-brand-600 to-accent-600 px-6 py-10 text-white sm:px-10 sm:py-14">
        <div className="bg-grid absolute inset-0 opacity-40" aria-hidden="true" />
        <div className="relative max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" /> Let's get you set up
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold tracking-tight sm:text-3xl">Create your first chatbot</h2>
          <p className="mt-2 text-brand-100">
            Enter your website URL and we'll build an assistant that answers visitor questions from your own content.
          </p>
          <Button asChild size="lg" variant="secondary" className="mt-6 bg-white text-brand-700 hover:bg-brand-50">
            <Link to="/app/chatbots/new">
              <Plus /> Create your first chatbot
            </Link>
          </Button>
        </div>
      </div>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="flex items-start gap-3 bg-white p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <s.icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {i + 1}. {s.title}
              </p>
              <p className="text-sm text-slate-500">{s.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const [days, setDays] = useState<number>(30);
  const { user } = useAuth();
  const stats = useQuery({
    queryKey: qk.dashboard(days),
    queryFn: ({ signal }) => api.get<DashboardStats>(`/dashboard/stats?days=${days}`, { signal }),
    placeholderData: (prev) => prev,
  });
  const chatbots = useChatbots();

  const firstName = user?.displayName?.split(' ')[0];
  const header = (
    <PageHeader
      title={firstName ? `Welcome back, ${firstName}` : 'Dashboard'}
      description="An overview of your chatbots, conversations and plan usage."
      actions={
        <Button asChild>
          <Link to="/app/chatbots/new">
            <Plus /> Create chatbot
          </Link>
        </Button>
      }
    />
  );

  if (stats.isLoading) {
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  }
  if (stats.isError || !stats.data) {
    return (
      <>
        {header}
        <ErrorState error={stats.error} title="Couldn't load your dashboard" onRetry={() => stats.refetch()} />
      </>
    );
  }

  const s = stats.data;
  const isNew = s.chatbots.total === 0;
  const latestBot = chatbots.data?.items[0];
  const limits = s.plan.limits;

  return (
    <div>
      {header}
      {isNew ? (
        <div className="space-y-6">
          <FirstChatbotEmptyState />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-700">Overview</h2>
            <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={days === r}
                  onClick={() => setDays(r)}
                  className={cn(
                    'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    days === r ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {r} days
                </button>
              ))}
            </div>
          </div>

          <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4 transition-opacity', stats.isFetching && 'opacity-70')}>
            <StatCard
              label="Chatbots"
              value={formatNumber(s.chatbots.total)}
              icon={Bot}
              to="/app/chatbots"
              hint={
                <>
                  <span className="font-medium text-emerald-700">{formatNumber(s.chatbots.published)} published</span> ·{' '}
                  {formatNumber(s.chatbots.draft)} draft
                </>
              }
            />
            <StatCard
              label="Conversations"
              value={formatNumber(s.conversations.count)}
              icon={MessageSquare}
              to="/app/conversations"
              hint={`In the last ${s.conversations.days} days`}
            />
            <StatCard label="Leads" value={formatNumber(s.leads.count)} icon={UserPlus} to="/app/leads" hint={`In the last ${s.leads.days} days`} />
            <StatCard
              label="Messages this month"
              value={formatNumber(s.usage.messages)}
              icon={Sparkles}
              to="/app/billing"
              hint={
                <>
                  of {formatNumber(limits.messagesPerMonth)} on {s.plan.name} · resets {formatDate(s.usage.resetAt, 'MMM d')}
                </>
              }
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>Conversations</CardTitle>
                  <CardDescription>Per day, last {s.conversations.days} days</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {s.conversations.series.length === 0 || s.conversations.count === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 text-center">
                    <MessageSquare className="mb-2 h-6 w-6 text-slate-300" />
                    <p className="text-sm font-medium text-slate-700">No conversations in this period</p>
                    <p className="mt-1 max-w-xs text-xs text-slate-500">Publish a chatbot and install it on your site to start receiving conversations.</p>
                  </div>
                ) : (
                  <ConversationsChart series={s.conversations.series} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Plan usage</CardTitle>
                <CardDescription>
                  {s.plan.name} plan · resets {formatDate(s.usage.resetAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageRow label="Messages" used={s.usage.messages} limit={limits.messagesPerMonth} />
                <UsageRow label="Website crawls" used={s.usage.crawls} limit={limits.crawlsPerMonth} />
                <UsageRow label="Leads" used={s.usage.leads} limit={limits.leadsPerMonth} />
                <UsageRow label="Chatbots" used={s.chatbots.total} limit={limits.chatbots} />
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/app/billing">
                    View usage & plans <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ActivityList items={s.recentActivity} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Quick actions</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button asChild variant="outline" className="justify-start">
                  <Link to="/app/chatbots/new">
                    <Plus /> Create a chatbot
                  </Link>
                </Button>
                {latestBot && (
                  <>
                    <Button asChild variant="outline" className="justify-start">
                      <Link to={`/app/chatbots/${latestBot.id}?tab=preview`}>
                        <Eye /> <span className="truncate">Preview {latestBot.name}</span>
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="justify-start">
                      <Link to={`/app/chatbots/${latestBot.id}?tab=publish`}>
                        <Rocket /> <span className="truncate">Install {latestBot.name}</span>
                      </Link>
                    </Button>
                  </>
                )}
                <Button asChild variant="outline" className="justify-start">
                  <Link to="/app/chatbots">
                    <Bot /> Manage chatbots
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
