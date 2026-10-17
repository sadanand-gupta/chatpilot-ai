import type {
  CreateSourceInput,
  CrawlPageResult,
  KnowledgeChunk,
  KnowledgeSource,
  KnowledgeSourceDetail,
  Plan,
  SiteMeta,
  UpdateSourceInput,
} from '@chatpilot/shared';
import type { CrawlOutput } from '../crawler/crawler';
import { increment } from '../data/docdb';
import type { ChatbotRecord, ListOpts, Page, SourceWithChunks, Store } from '../data/store';
import { AppError, badRequest, notFound } from '../lib/errors';
import { nowIso } from '../lib/http';
import { newId } from '../lib/ids';
import type { Logger } from '../lib/logger';
import { chunkFaq, chunkManual, chunkSections, joinChunks, type ChunkDraft } from '../knowledge/chunker';
import type { Retriever } from '../knowledge/retriever';

type ChunkRecord = KnowledgeChunk & { overlap?: number };

const preview = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300);

export class KnowledgeService {
  constructor(
    private readonly store: Store,
    private readonly retriever: Retriever,
    private readonly logger: Logger,
  ) {}

  private toChunks(bot: ChatbotRecord, sourceId: string, drafts: ChunkDraft[]): ChunkRecord[] {
    return drafts.map((d, i) => ({
      id: `${sourceId}_${String(i).padStart(4, '0')}`,
      chatbotId: bot.id,
      ownerId: bot.ownerId,
      sourceId,
      url: d.url,
      title: d.title,
      heading: d.heading,
      text: d.text,
      position: i,
      overlap: d.overlap || undefined,
    }));
  }

  private draftsFor(type: 'faq' | 'manual', title: string, content: string): ChunkDraft[] {
    return type === 'faq' ? chunkFaq(title, content) : chunkManual(title, content);
  }

  /** Characters currently used by active sources (knowledgeCharsPerBot limit). */
  async activeChars(chatbotId: string, excludeSourceId?: string): Promise<number> {
    const sources = await this.store.listAllSources(chatbotId);
    return sources.filter((s) => s.status === 'active' && s.id !== excludeSourceId).reduce((n, s) => n + (s.charCount ?? 0), 0);
  }

  private assertCharLimit(plan: Plan, used: number, adding: number): void {
    const limit = plan.limits.knowledgeCharsPerBot;
    if (used + adding > limit) {
      throw new AppError(402, 'quota_exceeded', `This would exceed your plan's knowledge limit of ${limit.toLocaleString('en-US')} characters per chatbot.`, {
        metric: 'knowledgeChars',
        limit,
        used,
        resetAt: '',
        planId: plan.id,
      });
    }
  }

  /** Recomputes stats and bumps knowledgeVersion (invalidates retrieval caches). */
  async refresh(bot: ChatbotRecord, extra: Record<string, unknown> = {}): Promise<void> {
    const sources = await this.store.listAllSources(bot.id);
    const active = sources.filter((s) => s.status === 'active');
    await this.store.updateChatbot(bot.id, {
      'stats.sources': active.length,
      'stats.chunks': active.reduce((n, s) => n + (s.chunkCount ?? 0), 0),
      knowledgeVersion: increment(1),
      updatedAt: nowIso(),
      ...extra,
    });
    this.retriever.invalidate(bot.id);
  }

  list(bot: ChatbotRecord, opts: ListOpts): Promise<Page<KnowledgeSource>> {
    return this.store.listSources(bot.id, opts);
  }

  async get(bot: ChatbotRecord, sourceId: string): Promise<KnowledgeSourceDetail> {
    const src = await this.store.getSource(bot.id, sourceId);
    if (!src || src.ownerId !== bot.ownerId) throw notFound('Source');
    const chunks = (await this.store.getSourceChunks(bot.id, sourceId)) as ChunkRecord[];
    let content = joinChunks(chunks);
    if (src.type === 'faq' && chunks.length > 1) content = chunks.map((c) => c.text.replace(/^Q: .*\nA: /, '')).join(' ');
    if (src.type === 'faq' && chunks.length === 1) content = chunks[0].text.replace(/^Q: .*\nA: /s, '');
    return { ...src, content };
  }

  async create(bot: ChatbotRecord, plan: Plan, input: CreateSourceInput): Promise<KnowledgeSource> {
    const title = input.type === 'faq' ? input.question : input.title;
    const content = input.type === 'faq' ? input.answer : input.content;
    const charCount = input.type === 'faq' ? input.question.length + input.answer.length : content.length;
    this.assertCharLimit(plan, await this.activeChars(bot.id), charCount);
    const id = newId();
    const drafts = this.draftsFor(input.type, title, content);
    const chunks = this.toChunks(bot, id, drafts);
    const now = nowIso();
    const source: KnowledgeSource = {
      id,
      chatbotId: bot.id,
      ownerId: bot.ownerId,
      type: input.type,
      title: title.slice(0, 300),
      status: 'active',
      charCount,
      chunkCount: chunks.length,
      preview: preview(content),
      createdAt: now,
      updatedAt: now,
    };
    await this.store.writeSources(bot.id, [{ source, chunks }]);
    await this.refresh(bot);
    return source;
  }

  async update(bot: ChatbotRecord, plan: Plan, sourceId: string, input: UpdateSourceInput): Promise<KnowledgeSource> {
    const src = await this.store.getSource(bot.id, sourceId);
    if (!src || src.ownerId !== bot.ownerId) throw notFound('Source');
    const patch: Partial<KnowledgeSource> = { updatedAt: nowIso() };
    if (input.status) {
      if (src.status === 'failed') throw badRequest('Failed sources cannot be re-activated; re-crawl instead.');
      if (input.status === 'active' && src.status !== 'active') this.assertCharLimit(plan, await this.activeChars(bot.id, src.id), src.charCount);
      patch.status = input.status;
    }
    if (input.title !== undefined) patch.title = input.title;
    if (input.content !== undefined) {
      if (src.type === 'page') throw badRequest('Crawled page content cannot be edited. Exclude it and add a manual source instead.', {
        fieldErrors: { content: ['Not editable for crawled pages'] },
      });
      const title = patch.title ?? src.title;
      const charCount = src.type === 'faq' ? title.length + input.content.length : input.content.length;
      if ((patch.status ?? src.status) === 'active') this.assertCharLimit(plan, await this.activeChars(bot.id, src.id), charCount);
      const chunks = this.toChunks(bot, src.id, this.draftsFor(src.type, title, input.content));
      patch.charCount = charCount;
      patch.chunkCount = chunks.length;
      patch.preview = preview(input.content);
      await this.store.replaceSourceChunks(bot.id, src.id, chunks, patch);
    } else if (input.title !== undefined && src.type === 'faq') {
      // The FAQ question is part of the chunk text: rechunk.
      const detail = await this.get(bot, src.id);
      const chunks = this.toChunks(bot, src.id, chunkFaq(input.title, detail.content));
      patch.chunkCount = chunks.length;
      await this.store.replaceSourceChunks(bot.id, src.id, chunks, patch);
    } else {
      await this.store.updateSource(bot.id, src.id, patch);
    }
    await this.refresh(bot);
    return { ...src, ...patch };
  }

  async remove(bot: ChatbotRecord, sourceId: string): Promise<void> {
    const src = await this.store.getSource(bot.id, sourceId);
    if (!src || src.ownerId !== bot.ownerId) throw notFound('Source');
    await this.store.deleteSources(bot.id, [src.id]);
    await this.refresh(bot);
  }

  /**
   * Applies a finished crawl: replaces 'page' sources from older crawls, keeps
   * FAQ/manual sources, keeps excluded URLs excluded, enforces the plan's
   * knowledge limit, rechunks and bumps knowledgeVersion.
   * Returns per-page adjustments (pages skipped because of the knowledge limit).
   */
  async applyCrawl(
    bot: ChatbotRecord,
    plan: Plan,
    jobId: string,
    output: CrawlOutput,
    siteMeta?: SiteMeta,
  ): Promise<{ added: number; limited: CrawlPageResult[] }> {
    const existing = await this.store.listAllSources(bot.id);
    const keep = existing.filter((s) => s.type !== 'page');
    const excludedPages = new Map(existing.filter((s) => s.type === 'page' && s.status === 'excluded' && s.url).map((s) => [s.url!, s]));
    const toDelete = existing.filter((s) => s.type === 'page' && !(s.status === 'excluded' && s.url && excludedPages.has(s.url)));

    let used = keep.filter((s) => s.status === 'active').reduce((n, s) => n + s.charCount, 0);
    const limit = plan.limits.knowledgeCharsPerBot;
    const now = nowIso();
    const items: SourceWithChunks[] = [];
    const limited: CrawlPageResult[] = [];
    const refreshedExcluded: { source: KnowledgeSource; chunks: ChunkRecord[] }[] = [];

    for (const page of output.pages) {
      const prevExcluded = excludedPages.get(page.url);
      const status = prevExcluded ? 'excluded' : 'active';
      let sections = page.sections;
      let charCount = page.text.length;
      if (status === 'active') {
        if (used >= limit) {
          limited.push({ url: page.url, status: 'skipped', title: page.title, reason: 'Knowledge limit of your plan reached' });
          continue;
        }
        if (used + charCount > limit) {
          // Truncate the last page to fit.
          let room = limit - used;
          const trimmed = [];
          for (const s of sections) {
            if (room <= 0) break;
            const text = s.text.slice(0, room);
            trimmed.push({ ...s, text });
            room -= text.length + (s.heading?.length ?? 0);
          }
          sections = trimmed;
          charCount = sections.reduce((n, s) => n + s.text.length, 0);
        }
        used += charCount;
      }
      const id = prevExcluded?.id ?? newId();
      const drafts = chunkSections(sections, { title: page.title || page.url, url: page.url });
      const chunks = this.toChunks(bot, id, drafts);
      const source: KnowledgeSource = {
        id,
        chatbotId: bot.id,
        ownerId: bot.ownerId,
        type: 'page',
        url: page.url,
        title: (page.title || page.url).slice(0, 300),
        status,
        charCount,
        chunkCount: chunks.length,
        preview: preview(page.text),
        crawlJobId: jobId,
        createdAt: prevExcluded?.createdAt ?? now,
        updatedAt: now,
      };
      if (prevExcluded) refreshedExcluded.push({ source, chunks });
      else items.push({ source, chunks });
    }

    // Delete old page sources first, then write the new ones.
    if (toDelete.length) await this.store.deleteSources(bot.id, toDelete.map((s) => s.id));
    for (const r of refreshedExcluded) await this.store.replaceSourceChunks(bot.id, r.source.id, r.chunks, r.source);
    // Write in groups to keep each batch well under Firestore limits.
    for (let i = 0; i < items.length; i += 5) await this.store.writeSources(bot.id, items.slice(i, i + 5));

    const extra: Record<string, unknown> = {};
    if (siteMeta) extra.siteMeta = siteMeta;
    await this.refresh(bot, extra);
    this.logger.info({ chatbotId: bot.id, jobId, added: items.length, removed: toDelete.length, limited: limited.length }, 'crawl applied');
    return { added: items.length, limited };
  }
}
