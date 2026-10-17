import type { CrawlJob, CrawlPageResult, Plan, StartCrawlInput } from '@chatpilot/shared';
import type { Env } from '../config/env';
import { crawlSite, type CrawlOutput } from '../crawler/crawler';
import type { FrameChecker } from '../crawler/frameCheck';
import type { RawLookup } from '../crawler/safeFetch';
import { validatePublicUrl, type LookupAllFn, type UrlSafetyOptions } from '../crawler/urlSafety';
import type { ChatbotRecord, ListOpts, Page, Store } from '../data/store';
import { AppError, conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/http';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import type { JobQueue } from './jobQueue';
import type { KnowledgeService } from './knowledge';
import type { UsageService } from './usage';

export const MAX_JOB_PAGES = 200;

/** Test-only network overrides (never configurable from env). */
export interface CrawlerOverrides extends UrlSafetyOptions {
  lookup?: RawLookup;
  lookupAll?: LookupAllFn;
  /** Skip sitemap discovery (keeps tests fast/deterministic). */
  useSitemap?: boolean;
}

export interface CrawlFinishedEvent {
  bot: ChatbotRecord;
  job: CrawlJob;
  output?: CrawlOutput;
}

export class CrawlService {
  private finishedHooks: ((e: CrawlFinishedEvent) => Promise<void>)[] = [];

  constructor(
    private readonly env: Env,
    private readonly store: Store,
    private readonly queue: JobQueue,
    /** Separate, smaller queue so public demos can never starve tenant crawls. */
    readonly demoQueue: JobQueue,
    private readonly knowledge: KnowledgeService,
    private readonly usage: UsageService,
    private readonly frameChecker: FrameChecker,
    private readonly logger: Logger,
    private readonly overrides: CrawlerOverrides = {},
  ) {}

  isActive(jobId: string): boolean {
    return this.queue.has(jobId) || this.demoQueue.has(jobId);
  }

  get userAgent(): string {
    return `ChatPilotBot/1.0 (+${this.env.PUBLIC_APP_URL}/bot)`;
  }

  onFinished(hook: (e: CrawlFinishedEvent) => Promise<void>): void {
    this.finishedHooks.push(hook);
  }

  validateUrl(input: string): Promise<URL> {
    return validatePublicUrl(input, this.overrides, this.overrides.lookupAll);
  }

  async list(bot: ChatbotRecord, opts: ListOpts): Promise<Page<CrawlJob>> {
    return this.store.listCrawlJobs(bot.id, opts);
  }

  async get(bot: ChatbotRecord, jobId: string): Promise<CrawlJob> {
    const job = await this.store.getCrawlJob(bot.id, jobId);
    if (!job || job.ownerId !== bot.ownerId) throw notFound('Crawl job');
    return job;
  }

  /**
   * Validates, records usage and enqueues a crawl. `queueKey` serialises jobs
   * (per owner for tenants, per IP for demos).
   */
  async start(
    bot: ChatbotRecord,
    plan: Plan | null,
    input: StartCrawlInput,
    opts: { queueKey?: string; maxPages?: number; skipQuota?: boolean; demo?: boolean } = {},
  ): Promise<CrawlJob> {
    const running = await this.store.listCrawlJobs(bot.id, { limit: 5 });
    if (running.items.some((j) => (j.status === 'queued' || j.status === 'running') && this.isActive(j.id))) {
      throw conflict('A crawl is already in progress for this chatbot.');
    }
    if (plan && !opts.skipQuota) await this.usage.check(bot.ownerId, plan, 'crawls');
    const url = await this.validateUrl(input.url ?? bot.websiteUrl);
    const planMax = plan?.limits.pagesPerCrawl ?? this.env.MAX_CRAWL_PAGES;
    const maxPages = Math.max(1, Math.min(opts.maxPages ?? input.maxPages ?? planMax, planMax, this.env.MAX_CRAWL_PAGES, MAX_JOB_PAGES));
    const job: CrawlJob = {
      id: newId(),
      chatbotId: bot.id,
      ownerId: bot.ownerId,
      startUrl: url.href,
      status: 'queued',
      stats: { discovered: 0, processed: 0, skipped: 0, failed: 0 },
      pages: [],
      maxPages,
      createdAt: nowIso(),
    };
    await this.store.createCrawlJob(job);
    const queue = opts.demo ? this.demoQueue : this.queue;
    try {
      queue.enqueue(opts.queueKey ?? bot.ownerId, job.id, (signal) => this.run(bot.id, job, plan, signal));
    } catch (e) {
      await this.store.updateCrawlJob(bot.id, job.id, { status: 'failed', error: 'The crawler is busy. Please try again in a few minutes.', finishedAt: nowIso() });
      throw e;
    }
    if (plan && !opts.skipQuota) await this.usage.record(bot.ownerId, { crawls: 1 });
    this.logger.info({ chatbotId: bot.id, jobId: job.id, maxPages }, 'crawl queued');
    return job;
  }

  async cancel(bot: ChatbotRecord, jobId: string): Promise<CrawlJob> {
    const job = await this.get(bot, jobId);
    if (job.status !== 'queued' && job.status !== 'running') return job;
    const where = this.queue.cancel(jobId) ?? this.demoQueue.cancel(jobId);
    if (where !== 'running') {
      // Queued (or orphaned after a restart): mark cancelled right away.
      const patch = { status: 'cancelled' as const, finishedAt: nowIso() };
      await this.store.updateCrawlJob(bot.id, jobId, patch);
      return { ...job, ...patch };
    }
    // Running: the runner observes the abort signal and writes the final state.
    await this.queue.idleFor(jobId);
    await this.demoQueue.idleFor(jobId);
    return this.get(bot, jobId);
  }

  private async run(chatbotId: string, initial: CrawlJob, plan: Plan | null, signal: AbortSignal): Promise<void> {
    const startedAt = nowIso();
    let job: CrawlJob = { ...initial, status: 'running', startedAt };
    await this.store.updateCrawlJob(chatbotId, job.id, { status: 'running', startedAt });
    const pages: CrawlPageResult[] = [];
    let lastWrite = Promise.resolve();
    let output: CrawlOutput | undefined;
    let bot: ChatbotRecord | null = null;
    try {
      const knowledgeLimit = plan?.limits.knowledgeCharsPerBot;
      output = await crawlSite({
        startUrl: job.startUrl,
        maxPages: job.maxPages,
        maxDepth: this.env.MAX_CRAWL_DEPTH,
        concurrency: this.env.CRAWL_CONCURRENCY,
        pageTimeoutMs: this.env.CRAWL_PAGE_TIMEOUT_MS,
        maxPageBytes: this.env.CRAWL_MAX_PAGE_BYTES,
        userAgent: this.userAgent,
        signal,
        allowPrivateForTests: this.overrides.allowPrivateForTests,
        lookup: this.overrides.lookup,
        useSitemap: this.overrides.useSitemap,
        maxTotalChars: knowledgeLimit,
        onPage: (r, stats) => {
          pages.push(r);
          if (pages.length > MAX_JOB_PAGES) pages.shift();
          job = { ...job, stats, pages: [...pages] };
          // Serialise progress writes; each page updates the job document.
          lastWrite = lastWrite.then(() => this.store.updateCrawlJob(chatbotId, job.id, { stats, pages: [...pages] })).catch(() => undefined);
        },
      });
      await lastWrite;
      bot = await this.store.getChatbot(chatbotId);
      if (!bot) throw new AppError(404, 'not_found', 'Chatbot was deleted during the crawl');

      if (signal.aborted || output.cancelled) {
        job = { ...job, status: 'cancelled', finishedAt: nowIso() };
      } else if (output.error) {
        job = { ...job, status: 'failed', error: output.error, finishedAt: nowIso() };
      } else {
        let siteMeta = output.siteMeta;
        if (siteMeta) {
          try {
            const frame = await this.frameChecker.check(siteMeta.url);
            siteMeta = { ...siteMeta, frameable: frame.frameable, frameBlockReason: frame.reason };
          } catch {
            /* optional */
          }
        }
        if (output.pages.length) {
          const effectivePlan: Plan = plan ?? ({ limits: { knowledgeCharsPerBot: Number.MAX_SAFE_INTEGER } } as Plan);
          const applied = await this.knowledge.applyCrawl(bot, effectivePlan, job.id, output, siteMeta);
          if (applied.limited.length) {
            const limitedUrls = new Set(applied.limited.map((l) => l.url));
            const adjusted = pages.map((p) => (limitedUrls.has(p.url) ? applied.limited.find((l) => l.url === p.url)! : p));
            job.pages = adjusted;
            job.stats = {
              ...job.stats,
              processed: job.stats.processed - applied.limited.length,
              skipped: job.stats.skipped + applied.limited.length,
            };
          }
        } else if (siteMeta) {
          await this.store.updateChatbot(bot.id, { siteMeta, updatedAt: nowIso() });
        }
        job = { ...job, status: 'completed', finishedAt: nowIso(), ...(output.hint ? { hint: output.hint } : {}) };
      }
    } catch (e) {
      await lastWrite;
      this.logger.error({ chatbotId, jobId: job.id, err: (e as Error).message }, 'crawl failed');
      job = { ...job, status: 'failed', error: 'The crawl failed unexpectedly. Please try again.', finishedAt: nowIso() };
    }
    await this.store
      .updateCrawlJob(chatbotId, job.id, {
        status: job.status,
        stats: job.stats,
        pages: job.pages,
        finishedAt: job.finishedAt,
        ...(job.error ? { error: job.error } : {}),
        ...(job.hint ? { hint: job.hint } : {}),
      })
      .catch((e) => this.logger.error({ err: (e as Error).message }, 'could not write crawl job'));
    if (job.stats.processed && bot && !bot.isDemo) await this.usage.record(bot.ownerId, { pagesCrawled: job.stats.processed }).catch(() => undefined);
    this.logger.info({ chatbotId, jobId: job.id, status: job.status, ...job.stats }, 'crawl finished');
    if (bot) {
      for (const hook of this.finishedHooks) {
        await hook({ bot, job, output }).catch((e) => this.logger.error({ err: (e as Error).message }, 'crawl hook failed'));
      }
    }
  }

  /** Jobs cannot survive a restart (in-process queue): mark leftovers failed on boot. */
  async recoverOnBoot(): Promise<number> {
    const stale = await this.store.listCrawlJobsByStatus(['running', 'queued'], 500);
    for (const j of stale) {
      if (this.isActive(j.id)) continue;
      await this.store
        .updateCrawlJob(j.chatbotId, j.id, {
          status: 'failed',
          error: 'The server restarted while this crawl was running. Please start it again.',
          finishedAt: nowIso(),
        })
        .catch(() => undefined);
    }
    if (stale.length) this.logger.warn({ count: stale.length }, 'marked interrupted crawl jobs as failed');
    return stale.length;
  }
}
