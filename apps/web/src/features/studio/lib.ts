import { useQuery } from '@tanstack/react-query';
import type {
  Chatbot,
  FrameCheckResult,
  KnowledgeSource,
  MeResponse,
  Paginated,
  SiteMeta,
} from '@chatpilot/shared';
import { api, ApiError, publicApi } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { hostnameOf, safeHref } from '@/lib/utils';

/* ------------------------------------------------------------------ devices */

export type DeviceKind = 'desktop' | 'tablet' | 'mobile';

export const DEVICES: Record<DeviceKind, { label: string; width: number; height: number }> = {
  desktop: { label: 'Desktop', width: 1440, height: 900 },
  tablet: { label: 'Tablet', width: 834, height: 1112 },
  mobile: { label: 'Mobile', width: 390, height: 844 },
};

/** SiteMeta may carry an optional screenshot (not yet in the shared contract). */
export type SiteMetaWithShot = SiteMeta & { screenshotUrl?: string };

/* ------------------------------------------------------------------ labels */

export const LANGUAGE_LABELS: Record<string, string> = {
  auto: 'Auto-detect (match the visitor)',
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ar: 'Arabic',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
};

export const BUSINESS_CATEGORIES = [
  'Restaurant & café',
  'Retail & e-commerce',
  'Healthcare & clinic',
  'Real estate',
  'Education & coaching',
  'Professional services',
  'Salon, spa & fitness',
  'Travel & hospitality',
  'Software & SaaS',
  'Home services',
] as const;

export const TONE_LABELS: Record<string, string> = {
  friendly: 'Friendly',
  professional: 'Professional',
  concise: 'Concise',
  enthusiastic: 'Enthusiastic',
};

/* ------------------------------------------------------------------ helpers */

/** http(s)-only URL guard for hrefs/srcs built from API data (re-exported from '@/lib/utils'). */
export { safeHref };

/** "acme-bakery.co.in" -> "Acme Bakery" */
export function businessNameFromUrl(url: string): string {
  const host = hostnameOf(url);
  if (!host) return '';
  const label = host.split('.')[0] ?? '';
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const NAV_QUESTION_RULES: [RegExp, (site: string) => string][] = [
  [/pric|plan|rate|fee|cost|tariff/i, () => 'How much do your services cost?'],
  [/contact|reach|get in touch/i, () => 'How can I contact you?'],
  [/about|story|who we are|team/i, (s) => `Tell me about ${s}`],
  [/service|solution|what we do|treatment/i, () => 'What services do you offer?'],
  [/product|shop|store|collection|catalog/i, () => 'What products do you sell?'],
  [/menu|food|dish/i, () => 'What is on your menu?'],
  [/book|appoint|reserv|schedul/i, () => 'How do I book an appointment?'],
  [/career|job|hiring|join/i, () => 'Are you hiring right now?'],
  [/faq|help|support/i, () => 'Where can I get help with an order?'],
  [/location|branch|store locator|visit|find us/i, () => 'Where are you located?'],
  [/deliver|shipping/i, () => 'Do you offer delivery, and how long does it take?'],
  [/return|refund|exchange/i, () => 'What is your return policy?'],
  [/course|class|program|admission/i, () => 'What courses do you offer?'],
  [/propert|listing|rent|buy|sell/i, () => 'What properties are available?'],
  [/portfolio|work|case stud|project/i, () => 'Can I see examples of your work?'],
];

/**
 * Proposes visitor questions from the crawled site metadata (client-side, no AI call).
 * Returns de-duplicated questions not already present in `existing`.
 */
export function suggestQuestionsFromSite(
  siteMeta: SiteMeta | undefined,
  businessName: string,
  existing: string[] = [],
): string[] {
  const site = siteMeta?.siteName || businessName || 'your business';
  const out: string[] = [];
  const push = (q: string) => {
    const norm = q.trim();
    if (!norm) return;
    const key = norm.toLowerCase();
    if (out.some((x) => x.toLowerCase() === key) || existing.some((x) => x.toLowerCase() === key)) return;
    out.push(norm);
  };
  for (const label of siteMeta?.navLinks ?? []) {
    const rule = NAV_QUESTION_RULES.find(([re]) => re.test(label));
    if (rule) push(rule[1](site));
  }
  push('What are your opening hours?');
  push(`What makes ${site} different?`);
  push('How can I contact you?');
  return out.slice(0, 6);
}

export function isTerminalCrawl(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** Maps API error codes to friendly copy used across the studio. */
export function friendlyError(e: unknown): { title: string; description: string } {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'invalid_url':
        return { title: 'That URL looks invalid', description: e.message || 'Check the address and try again.' };
      case 'crawl_blocked':
        return {
          title: 'The website blocked our crawler',
          description:
            e.message ||
            'The site refused automated access (robots.txt, a firewall or bot protection). You can still add content manually.',
        };
      case 'quota_exceeded':
        return { title: 'Plan limit reached', description: e.message };
      case 'rate_limited':
        return { title: 'Slow down a little', description: e.message || 'Too many requests. Please wait a moment and retry.' };
      case 'ai_unavailable':
        return {
          title: 'AI provider unavailable',
          description: e.message || 'The AI provider did not respond. Please try again in a minute.',
        };
      case 'network_error':
        return { title: 'Cannot reach the server', description: 'Check your connection and that the API is running.' };
      default:
        return { title: 'Something went wrong', description: e.message || 'Please try again.' };
    }
  }
  return { title: 'Something went wrong', description: e instanceof Error ? e.message : 'Please try again.' };
}

/* ------------------------------------------------------------------ queries */

export const studioKeys = {
  frameCheck: (url: string) => ['frameCheck', url] as const,
  latestCrawl: (chatbotId: string) => ['crawlJob', chatbotId, 'latest'] as const,
  sourcesSummary: (chatbotId: string) => [...qk.sources(chatbotId), 'summary'] as const,
  sourcesList: (chatbotId: string) => [...qk.sources(chatbotId), 'list'] as const,
  source: (chatbotId: string, sourceId: string) => [...qk.sources(chatbotId), 'detail', sourceId] as const,
  demo: (demoId: string) => ['demo', demoId] as const,
  publicConfig: (publicId: string) => ['publicConfig', publicId] as const,
};

export function useChatbot(id: string | undefined, initial?: Chatbot) {
  return useQuery({
    queryKey: qk.chatbot(id ?? ''),
    queryFn: () => api.get<Chatbot>(`/chatbots/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    initialData: initial && initial.id === id ? initial : undefined,
    // initialData is treated as fresh; refetch shortly after for server truth.
    staleTime: 5_000,
  });
}

export function useMe() {
  return useQuery({
    queryKey: qk.me(),
    queryFn: () => api.get<MeResponse>('/me'),
    staleTime: 60_000,
  });
}

/** First page of sources — used for checklists and "has content" checks. */
export function useSourcesSummary(chatbotId: string) {
  return useQuery({
    queryKey: studioKeys.sourcesSummary(chatbotId),
    queryFn: () => api.get<Paginated<KnowledgeSource>>(`/chatbots/${encodeURIComponent(chatbotId)}/sources?limit=100`),
    staleTime: 5_000,
  });
}

export function useFrameCheck(url: string | undefined) {
  return useQuery({
    queryKey: studioKeys.frameCheck(url ?? ''),
    queryFn: () => publicApi.get<FrameCheckResult>(`/public/frame-check?url=${encodeURIComponent(url!)}`),
    enabled: Boolean(url),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/** Adds `chatpilot_preview=<token>` to a site URL. */
export function withPreviewParam(siteUrl: string, token: string): string {
  try {
    const u = new URL(siteUrl);
    u.searchParams.set('chatpilot_preview', token);
    return u.toString();
  } catch {
    return `${siteUrl}${siteUrl.includes('?') ? '&' : '?'}chatpilot_preview=${encodeURIComponent(token)}`;
  }
}

/** Inserts `data-preview-token` into a snippet produced by buildEmbedCode(). */
export function withPreviewToken(embedCode: string, token: string): string {
  if (embedCode.includes('\n  async')) {
    return embedCode.replace('\n  async', `\n  data-preview-token="${token}"\n  async`);
  }
  return embedCode.replace('<script', `<script data-preview-token="${token}"`);
}
