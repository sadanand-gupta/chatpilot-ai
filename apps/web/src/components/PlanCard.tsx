import type { ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import type { Plan } from '@chatpilot/shared';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export function planPrice(plan: Plan): { amount: string; suffix: string } {
  if (plan.priceMonthly === null) return { amount: 'Contact us', suffix: '' };
  if (plan.priceMonthly === 0) return { amount: formatCurrency(0, plan.currency), suffix: '/month' };
  return { amount: formatCurrency(plan.priceMonthly, plan.currency), suffix: '/month' };
}

export function planLimitLines(plan: Plan): { label: string; included: boolean }[] {
  const l = plan.limits;
  const f = plan.features;
  return [
    { label: `${formatNumber(l.chatbots)} chatbot${l.chatbots === 1 ? '' : 's'}`, included: true },
    { label: `${formatNumber(l.messagesPerMonth)} messages / month`, included: true },
    { label: `${formatNumber(l.crawlsPerMonth)} website crawls / month`, included: true },
    { label: `Up to ${formatNumber(l.pagesPerCrawl)} pages per crawl`, included: true },
    { label: `${formatNumber(l.leadsPerMonth)} leads / month`, included: true },
    { label: `${formatNumber(l.retentionDays)}-day conversation history`, included: true },
    { label: 'Lead capture', included: f.leadCapture },
    { label: 'CSV export of leads', included: f.csvExport },
    { label: 'Restrict to your domains', included: f.allowedOrigins },
    { label: `Remove "Powered by" branding`, included: f.removeBranding },
  ];
}

export function PlanCard({
  plan,
  current,
  action,
  dark = false,
}: {
  plan: Plan;
  current?: boolean;
  action?: ReactNode;
  dark?: boolean;
}) {
  const price = planPrice(plan);
  return (
    <div
      data-testid={`plan-${plan.id}`}
      className={cn(
        'relative flex flex-col rounded-2xl border p-6',
        dark ? 'border-white/10 bg-white/[0.03] text-white' : 'border-slate-200 bg-white',
        plan.highlighted && (dark ? 'border-brand-400/60 bg-brand-500/10 ring-1 ring-brand-400/40' : 'border-brand-300 ring-2 ring-brand-500/20'),
      )}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-3 py-0.5 text-xs font-semibold text-white shadow">
          Most popular
        </span>
      )}
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('font-display text-lg font-bold', dark ? 'text-white' : 'text-slate-900')}>{plan.name}</h3>
        {current && <Badge variant="success">Current plan</Badge>}
      </div>
      <p className={cn('mt-1 min-h-[2.5rem] text-sm', dark ? 'text-slate-400' : 'text-slate-500')}>{plan.description}</p>
      <p className="mt-4 flex items-baseline gap-1">
        <span className={cn('font-display text-3xl font-extrabold tracking-tight', dark ? 'text-white' : 'text-slate-900')}>{price.amount}</span>
        {price.suffix && <span className={cn('text-sm', dark ? 'text-slate-400' : 'text-slate-500')}>{price.suffix}</span>}
      </p>
      <ul className="mt-6 flex-1 space-y-2.5 text-sm">
        {planLimitLines(plan).map((line) => (
          <li key={line.label} className={cn('flex items-start gap-2', !line.included && 'opacity-50')}>
            {line.included ? (
              <Check className={cn('mt-0.5 h-4 w-4 shrink-0', dark ? 'text-brand-300' : 'text-brand-600')} aria-hidden="true" />
            ) : (
              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            )}
            <span className={dark ? 'text-slate-300' : 'text-slate-700'}>
              {!line.included && <span className="sr-only">Not included: </span>}
              {line.label}
            </span>
          </li>
        ))}
      </ul>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
