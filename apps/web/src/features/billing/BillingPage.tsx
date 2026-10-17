import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Mail } from 'lucide-react';
import type { Plan } from '@chatpilot/shared';
import { useChatbots, useMe, usePlans } from '@/lib/hooks';
import { billing } from '@/lib/billing';
import { appConfig } from '@/lib/config';
import { formatDate, formatNumber } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ErrorState';
import { PlanCard } from '@/components/PlanCard';

function UsageMeter({ label, used, limit, note }: { label: string; used: number; limit: number; note?: string }) {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-xs tabular-nums text-slate-500">{Math.min(100, Math.round(pct))}%</span>
      </div>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900">
        {formatNumber(used)} <span className="text-sm font-medium text-slate-400">/ {formatNumber(limit)}</span>
      </p>
      <Progress value={pct} className="mt-3" aria-label={`${label} usage`} />
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function UpgradeDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const contact = appConfig.contactEmail;
  const subject = encodeURIComponent(`Upgrade to ${plan?.name ?? 'a paid'} plan`);
  return (
    <Dialog open={Boolean(plan)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Billing is not enabled yet</DialogTitle>
          <DialogDescription>
            Online payments aren't live yet. Contact us and we'll move your account to the {plan?.name} plan manually.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {contact ? (
            <Button asChild>
              <a href={`mailto:${contact}?subject=${subject}`}>
                <Mail /> Email {contact}
              </a>
            </Button>
          ) : (
            <Button asChild>
              <Link to="/contact" onClick={onClose}>
                <Mail /> Contact us
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BillingPage() {
  const me = useMe();
  const plans = usePlans();
  const chatbots = useChatbots();
  const [upgradeTo, setUpgradeTo] = useState<Plan | null>(null);

  async function upgrade(plan: Plan) {
    if (!billing.enabled) {
      setUpgradeTo(plan);
      return;
    }
    const { url } = await billing.startCheckout(plan.id);
    window.location.assign(url);
  }

  if (me.isLoading) {
    return (
      <div>
        <PageHeader title="Usage & Plan" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  if (me.isError || !me.data) {
    return (
      <div>
        <PageHeader title="Usage & Plan" />
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }

  const { plan, usage } = me.data;
  const l = plan.limits;
  const reset = `Resets ${formatDate(usage.resetAt)}`;
  const currentIndex = plans.data?.findIndex((p) => p.id === plan.id) ?? -1;

  return (
    <div className="space-y-8">
      <PageHeader title="Usage & Plan" description="Track this month's usage against your plan limits." />

      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardDescription>Current plan</CardDescription>
            <CardTitle className="mt-1 font-display text-2xl">{plan.name}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
          </div>
          <p className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <CalendarClock className="h-4 w-4 text-slate-400" /> Usage period {usage.period} · {reset}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <UsageMeter label="Chat messages" used={usage.messages} limit={l.messagesPerMonth} note={reset} />
          <UsageMeter label="Website crawls" used={usage.crawls} limit={l.crawlsPerMonth} note={reset} />
          <UsageMeter label="Leads captured" used={usage.leads} limit={l.leadsPerMonth} note={reset} />
          <UsageMeter
            label="Chatbots"
            used={chatbots.data?.items.length ?? 0}
            limit={l.chatbots}
            note="Total chatbots in your account"
          />
          <div className="rounded-xl border border-slate-200 p-4">
            <span className="text-sm font-medium text-slate-700">Pages crawled</span>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900">{formatNumber(usage.pagesCrawled)}</p>
            <p className="mt-2 text-xs text-slate-500">This month · up to {formatNumber(l.pagesPerCrawl)} pages per crawl</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <span className="text-sm font-medium text-slate-700">Knowledge per chatbot</span>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900">{formatNumber(l.knowledgeCharsPerBot, { compact: true })}</p>
            <p className="mt-2 text-xs text-slate-500">characters · conversations kept {l.retentionDays} days</p>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="mb-1 font-display text-lg font-bold text-slate-900">
          Compare plans
        </h2>
        <p className="mb-6 text-sm text-slate-500">Prices shown per month. Upgrades are handled by our team while online billing is being set up.</p>
        {plans.isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[30rem] rounded-2xl" />
            ))}
          </div>
        ) : plans.isError ? (
          <ErrorState error={plans.error} title="Couldn't load plans" onRetry={() => plans.refetch()} />
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {plans.data!.map((p, i) => {
              const isCurrent = p.id === plan.id;
              const isUpgrade = currentIndex === -1 || i > currentIndex;
              return (
                <PlanCard
                  key={p.id}
                  plan={p}
                  current={isCurrent}
                  action={
                    isCurrent ? (
                      <Button variant="outline" className="w-full" disabled>
                        Your current plan
                      </Button>
                    ) : (
                      <Button variant={p.highlighted ? 'default' : 'outline'} className="w-full" onClick={() => void upgrade(p)}>
                        {p.priceMonthly === null ? 'Contact us' : isUpgrade ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                      </Button>
                    )
                  }
                />
              );
            })}
          </div>
        )}
      </section>
      <UpgradeDialog plan={upgradeTo} onClose={() => setUpgradeTo(null)} />
    </div>
  );
}
