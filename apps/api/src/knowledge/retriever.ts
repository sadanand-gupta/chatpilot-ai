import type { KnowledgeChunk, SourceType } from '@chatpilot/shared';
import type { Store } from '../data/store';
import { BM25Index } from './bm25';

/**
 * Retrieval interface. The BM25 implementation can later be swapped for an
 * embeddings/vector retriever without touching the chat service.
 */
export interface RetrievedChunk {
  chunk: KnowledgeChunk;
  sourceType: SourceType;
  score: number;
  matchedTerms: number;
}

export interface Retriever {
  search(chatbotId: string, query: string, k: number, opts?: { knowledgeVersion?: number }): Promise<RetrievedChunk[]>;
  /**
   * General context for overview questions ("what do you do?") and for queries
   * with no lexical match: the first chunks of the home page plus the top
   * FAQ/manual chunks. hasKnowledge=false means the bot has no active knowledge.
   */
  overview(chatbotId: string, opts?: { knowledgeVersion?: number }): Promise<{ hasKnowledge: boolean; chunks: RetrievedChunk[] }>;
  invalidate(chatbotId: string): void;
}

/** Minimum BM25 score for a chunk to count as relevant. Below this we answer with the fallback (no AI call). */
export const MIN_RELEVANCE_SCORE = 0.1;

const FAQ_BOOST = 1.25;

interface CacheEntry {
  version: number;
  index: BM25Index;
  chunks: Map<string, { chunk: KnowledgeChunk; type: SourceType }>;
  overviewIds: string[];
}

function pathDepth(url: string | undefined): number {
  if (!url) return 99;
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    return p ? p.split('/').length - 1 : 0;
  } catch {
    return 99;
  }
}

export class BM25Retriever implements Retriever {
  private cache = new Map<string, CacheEntry>();
  private building = new Map<string, Promise<CacheEntry>>();

  constructor(
    private readonly store: Store,
    private readonly maxEntries = 50,
  ) {}

  invalidate(chatbotId: string): void {
    this.cache.delete(chatbotId);
  }

  private async build(chatbotId: string, version: number): Promise<CacheEntry> {
    const [sources, chunks] = await Promise.all([this.store.listAllSources(chatbotId), this.store.listChunks(chatbotId)]);
    const active = new Map(sources.filter((s) => s.status === 'active').map((s) => [s.id, s.type] as const));
    const map = new Map<string, { chunk: KnowledgeChunk; type: SourceType }>();
    const docs = [];
    for (const c of chunks) {
      const type = active.get(c.sourceId);
      if (!type) continue; // excluded / failed / orphaned sources are never indexed
      map.set(c.id, { chunk: c, type });
      docs.push({
        id: c.id,
        text: c.text,
        title: [c.title, c.heading].filter(Boolean).join(' '),
        boost: type === 'faq' ? FAQ_BOOST : 1,
      });
    }
    // Overview context: first 3 chunks of the home page (shallowest page URL), then
    // the first chunk of up to 3 FAQ/manual sources.
    const activeSources = sources.filter((s) => s.status === 'active');
    const home = activeSources.filter((s) => s.type === 'page').sort((a, b) => pathDepth(a.url) - pathDepth(b.url))[0];
    const byPos = (a: KnowledgeChunk, b: KnowledgeChunk) => a.position - b.position;
    const overviewIds: string[] = [];
    if (home) overviewIds.push(...chunks.filter((c) => c.sourceId === home.id).sort(byPos).slice(0, 3).map((c) => c.id));
    for (const src of activeSources.filter((s) => s.type !== 'page').slice(0, 3)) {
      const first = chunks.filter((c) => c.sourceId === src.id).sort(byPos)[0];
      if (first) overviewIds.push(first.id);
    }
    if (!overviewIds.length && docs.length) overviewIds.push(...docs.slice(0, 3).map((d) => d.id));
    return { version, index: new BM25Index(docs), chunks: map, overviewIds };
  }

  private async entry(chatbotId: string, version: number): Promise<CacheEntry> {
    const hit = this.cache.get(chatbotId);
    if (hit && hit.version === version) {
      // LRU refresh
      this.cache.delete(chatbotId);
      this.cache.set(chatbotId, hit);
      return hit;
    }
    const key = `${chatbotId}:${version}`;
    let p = this.building.get(key);
    if (!p) {
      p = this.build(chatbotId, version).finally(() => this.building.delete(key));
      this.building.set(key, p);
    }
    const e = await p;
    this.cache.delete(chatbotId);
    this.cache.set(chatbotId, e);
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
    return e;
  }

  private async versionOf(chatbotId: string, v?: number): Promise<number> {
    return v ?? (await this.store.getChatbot(chatbotId))?.knowledgeVersion ?? 0;
  }

  async overview(chatbotId: string, opts: { knowledgeVersion?: number } = {}): Promise<{ hasKnowledge: boolean; chunks: RetrievedChunk[] }> {
    const e = await this.entry(chatbotId, await this.versionOf(chatbotId, opts.knowledgeVersion));
    return {
      hasKnowledge: e.chunks.size > 0,
      chunks: e.overviewIds.map((id) => {
        const c = e.chunks.get(id)!;
        return { chunk: c.chunk, sourceType: c.type, score: 0, matchedTerms: 0 };
      }),
    };
  }

  async search(chatbotId: string, query: string, k: number, opts: { knowledgeVersion?: number } = {}): Promise<RetrievedChunk[]> {
    const e = await this.entry(chatbotId, await this.versionOf(chatbotId, opts.knowledgeVersion));
    return e.index.search(query, k).map((h) => {
      const c = e.chunks.get(h.id)!;
      return { chunk: c.chunk, sourceType: c.type, score: h.score, matchedTerms: h.matchedTerms };
    });
  }
}
