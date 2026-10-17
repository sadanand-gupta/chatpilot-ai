import { Link } from 'react-router-dom';
import { Gauge } from 'lucide-react';
import type { QuotaErrorDetails } from '@chatpilot/shared';
import { isQuotaError } from '@/lib/api';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const METRIC_LABELS: Record<string, string> = {
  chatbots: 'chatbots',
  messages: 'chat messages this month',
  messagesPerMonth: 'chat messages this month',
  crawls: 'website crawls this month',
  crawlsPerMonth: 'website crawls this month',
  pagesCrawled: 'pages crawled this month',
  pagesPerCrawl: 'pages per crawl',
  leads: 'leads this month',
  leadsPerMonth: 'leads this month',
  knowledgeCharsPerBot: 'knowledge characters for this chatbot',
  aiTokens: 'AI tokens this month',
};

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function asDetails(d: unknown): Partial<QuotaErrorDetails> {
  return d && typeof d === 'object' ? (d as Partial<QuotaErrorDetails>) : {};
}

/** Renders a plan-limit notice for `quota_exceeded` API errors; renders nothing for anything else. */
export function QuotaNotice({ error, className }: { error: unknown; className?: string }) {
  if (!isQuotaError(error)) return null;
  const d = asDetails(error.details);
  const perMonth = d.metric ? !['chatbots', 'pagesPerCrawl', 'knowledgeCharsPerBot'].includes(d.metric) : false;
  return (
    <Alert variant="warning" className={cn('pr-4', className)} data-testid="quota-notice">
      <Gauge />
      <AlertTitle>Plan limit reached</AlertTitle>
      <AlertDescription>
        <p>
          {d.metric && typeof d.used === 'number' && typeof d.limit === 'number' ? (
            <>
              You've used <strong>{formatNumber(d.used)}</strong> of <strong>{formatNumber(d.limit)}</strong> {metricLabel(d.metric)}
              {d.planId ? <> on the <span className="capitalize">{d.planId}</span> plan</> : null}.
            </>
          ) : (
            error.message
          )}
          {perMonth && d.resetAt ? <> Usage resets on {formatDate(d.resetAt)}.</> : null}
        </p>
        <div className="mt-3">
          <Button asChild size="sm">
            <Link to="/app/billing">View plans &amp; upgrade</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
