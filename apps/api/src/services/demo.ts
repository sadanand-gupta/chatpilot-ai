import type { DemoSession, SiteMeta } from '@chatpilot/shared';
import type { Env } from '../config/env';
import { DEMO_OWNER, type ChatbotRecord, type Store } from '../data/store';
import { forbidden, notFound, rateLimited } from '../lib/errors';
import { nowIso } from '../lib/http';
import { newId, newPublicId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import { defaultConfigFor, type ChatbotService } from './chatbots';
import type { CrawlFinishedEvent, CrawlService } from './crawls';
import { demoEventId, type ActivityService } from './activity';

export const DEMO_TTL_MS = 2 * 60 * 60_000;

/** Hosting platforms where the business is the subdomain ("acme.vercel.app" -> "Acme"). */
const PLATFORM_SUFFIXES = [
  'vercel.app', 'netlify.app', 'github.io', 'gitlab.io', 'onrender.com', 'web.app', 'firebaseapp.com', 'pages.dev',
  'herokuapp.com', 'wixsite.com', 'wordpress.com', 'blogspot.com', 'myshopify.com', 'squarespace.com', 'webflow.io',
  'framer.website', 'framer.app', 'carrd.co', 'glitch.me', 'replit.app', 'surge.sh', 'azurewebsites.net', 'business.site',
];

/** "acme-dental.co.in" -> "Acme Dental"; "acme-dental.vercel.app" -> "Acme Dental" */
export function businessNameFromHost(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  const platform = PLATFORM_SUFFIXES.find((suffix) => host.endsWith(`.${suffix}`));
  if (platform) return titleCase(host.slice(0, -(platform.length + 1)).split('.').pop() ?? host) || host;
  // Drop public-suffix-like tails (co.in, com.au, …) heuristically.
  let label = parts[0];
  if (parts.length > 2 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length <= 3) label = parts[parts.length - 3];
  else if (parts.length >= 2) label = parts[parts.length - 2];
  return titleCase(label) || host;
}

function titleCase(label: string): string {
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Prefer the site's own name ("Auren.ai — AI Receptionists ..." -> "Auren.ai") over a hostname guess. */
export function businessNameFromSiteMeta(meta: SiteMeta | undefined): string | undefined {
  const generic = /^(home|homepage|home page|welcome|index|official (web)?site|main)$/i;
  const candidates = [meta?.siteName, ...(meta?.title?.split(/\s+[|—–·:-]\s+/) ?? [])];
  for (const raw of candidates) {
    const name = raw?.replace(/\s+/g, ' ').trim();
    if (name && name.length >= 2 && name.length <= 40 && !generic.test(name)) return name;
  }
  return undefined;
}

function demoConfig(config: ChatbotRecord['config'], name: string): ChatbotRecord['config'] {
  return {
    ...config,
    botName: `${name} Assistant`.slice(0, 60),
    headerTitle: `Chat with ${name}`.slice(0, 80),
    welcomeMessage: `Hi! 👋 I'm the ${name} assistant. Ask me anything about ${name}.`.slice(0, 500),
    leadCapture: { ...config.leadCapture, enabled: false },
  };
}

/** SiteMeta extended locally with an optional screenshot URL (contract addition, see report). */
export type DemoSiteMeta = SiteMeta & { screenshotUrl?: string };

export const DEMO_MAX_QUEUED = 20;

export class DemoService {
  /** Creation timestamps in the last hour (per instance) for DEMO_GLOBAL_PER_HOUR. */
  private recent: number[] = [];

  constructor(
    private readonly env: Env,
    private readonly store: Store,
    private readonly crawls: CrawlService,
    private readonly chatbots: ChatbotService,
    private readonly logger: Logger,
    private readonly activity?: ActivityService,
  ) {
    crawls.onFinished((e) => this.onCrawlFinished(e));
  }

  screenshotUrl(url: string): string | undefined {
    const t = this.env.SCREENSHOT_URL_TEMPLATE;
    if (!t) return undefined;
    const enc = encodeURIComponent(url);
    return t.includes('{url}') ? t.split('{url}').join(enc) : `${t}${enc}`;
  }

  private session(bot: ChatbotRecord, pagesProcessed?: number): DemoSession {
    const url = bot.demo?.url ?? bot.websiteUrl;
    const shot = this.screenshotUrl(url);
    const siteMeta: DemoSiteMeta | undefined = bot.siteMeta ? { ...bot.siteMeta, ...(shot ? { screenshotUrl: shot } : {}) } : shot ? { url, screenshotUrl: shot } : undefined;
    return {
      demoId: bot.id,
      publicId: bot.publicId,
      url,
      status: bot.demo?.status ?? 'crawling',
      siteMeta,
      pagesProcessed: pagesProcessed ?? bot.demo?.pagesProcessed ?? 0,
      error: bot.demo?.error,
      expiresAt: bot.expiresAt ?? nowIso(),
    };
  }

  async create(input: string, ip: string, userAgent?: string): Promise<DemoSession> {
    if (!this.env.DEMO_ENABLED) throw forbidden('The live demo is currently disabled.');
    const hourAgo = Date.now() - 60 * 60_000;
    this.recent = this.recent.filter((t) => t > hourAgo);
    if (this.crawls.demoQueue.queuedCount >= DEMO_MAX_QUEUED || this.recent.length >= this.env.DEMO_GLOBAL_PER_HOUR) {
      throw rateLimited('The live demo is very busy right now. Please try again in a few minutes, or sign up to build your own chatbot.');
    }
    const url = await this.crawls.validateUrl(input);
    const name = businessNameFromHost(url.hostname);
    const now = new Date();
    const config = defaultConfigFor(name);
    const bot: ChatbotRecord = {
      id: newId(),
      ownerId: DEMO_OWNER,
      publicId: newPublicId(),
      name: `${name} (demo)`,
      businessName: name,
      websiteUrl: url.href,
      language: 'auto',
      status: 'draft',
      config: demoConfig(config, name),
      allowedOrigins: [],
      knowledgeVersion: 0,
      stats: { sources: 0, chunks: 0, conversations: 0, leads: 0 },
      isDemo: true,
      expiresAt: new Date(now.getTime() + DEMO_TTL_MS).toISOString(),
      demo: { status: 'crawling', url: url.href, pagesProcessed: 0 },
      demoMessages: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.recent.push(Date.now());
    await this.store.createChatbot(bot);
    const job = await this.crawls.start(bot, null, { url: url.href }, { queueKey: `demo:${ip}`, maxPages: this.env.DEMO_MAX_PAGES, skipQuota: true, demo: true });
    bot.demo = { ...bot.demo!, jobId: job.id };
    await this.store.updateChatbot(bot.id, { demo: bot.demo });
    // Outlives the demo bot (deleted after DEMO_TTL_MS) so the admin console keeps the history.
    await this.activity?.log({
      id: demoEventId(bot.id),
      type: 'demo_started',
      ip,
      userAgent,
      url: url.href,
      chatbotId: bot.id,
      chatbotName: name,
      status: 'crawling',
      messages: 0,
    });
    this.logger.info({ demoId: bot.id }, 'demo created');
    return this.session(bot);
  }

  async get(demoId: string): Promise<DemoSession> {
    const bot = await this.store.getChatbot(demoId);
    if (!bot || !bot.isDemo || (bot.expiresAt && Date.parse(bot.expiresAt) < Date.now())) throw notFound('Demo');
    let pages: number | undefined;
    if (bot.demo?.status === 'crawling' && bot.demo.jobId) {
      const job = await this.store.getCrawlJob(bot.id, bot.demo.jobId);
      pages = job?.stats.processed;
    }
    return this.session(bot, pages);
  }

  private async onCrawlFinished({ bot: stale, job }: CrawlFinishedEvent): Promise<void> {
    if (!stale.isDemo) return;
    const bot = await this.store.getChatbot(stale.id);
    if (!bot) return;
    const demo = { ...(bot.demo ?? { url: bot.websiteUrl, pagesProcessed: 0 }), pagesProcessed: job.stats.processed, jobId: job.id };
    const hasKnowledge = (bot.stats?.sources ?? 0) > 0;
    if (job.status === 'completed' && hasKnowledge) {
      const siteName = businessNameFromSiteMeta(bot.siteMeta);
      if (siteName && siteName !== bot.businessName) {
        const patch = { businessName: siteName, name: `${siteName} (demo)`, config: demoConfig(bot.config, siteName) };
        await this.store.updateChatbot(bot.id, patch);
        Object.assign(bot, patch);
      }
      await this.chatbots.publishBot(bot, null);
      await this.store.updateChatbot(bot.id, { demo: { ...demo, status: 'ready' } });
      await this.activity?.update(demoEventId(bot.id), { status: 'ready', chatbotName: bot.businessName, detail: `${demo.pagesProcessed} page${demo.pagesProcessed === 1 ? '' : 's'} read` });
    } else {
      const error =
        job.error ?? job.hint ?? (job.status === 'cancelled' ? 'The demo crawl was cancelled.' : 'We could not read enough content from this website.');
      await this.store.updateChatbot(bot.id, { demo: { ...demo, status: 'failed', error } });
      await this.activity?.update(demoEventId(bot.id), { status: 'failed', detail: error.slice(0, 300) });
    }
  }
}
