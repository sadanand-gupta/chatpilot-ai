import type { KnowledgeChunk, SourceType } from '@chatpilot/shared';
import type { Store } from '../data/store';
import { BM25Index, jaccard, tokenize } from './bm25';
import { knowledgeTopics, type KnowledgeTopic } from './topics';

/**
 * Retrieval interface. The BM25 implementation can later be swapped for an
 * embeddings/vector retriever without touching the chat service.
 */
export interface RetrievedChunk {
  chunk: KnowledgeChunk;
  sourceType: SourceType;
  score: number;
  matchedTerms: number;
  /** IDF-weighted fraction (0..1) of the query's meaningful terms matched (0 for overview chunks). */
  coverage: number;
}

export interface Retriever {
  /** Top-k diverse chunks (max MAX_PER_SOURCE per source, near-duplicates dropped). */
  search(chatbotId: string, query: string, k: number, opts?: { knowledgeVersion?: number }): Promise<RetrievedChunk[]>;
  /**
   * General context for overview questions ("what do you do?") and for queries
   * with no lexical match: the first chunks of the home page plus the top
   * FAQ/manual chunks. hasKnowledge=false means the bot has no active knowledge.
   */
  overview(chatbotId: string, opts?: { knowledgeVersion?: number }): Promise<{ hasKnowledge: boolean; chunks: RetrievedChunk[] }>;
  /** Short labels of what the knowledge covers (cleaned page titles, FAQ questions), best first. */
  topics(chatbotId: string, businessName: string, opts?: { knowledgeVersion?: number }): Promise<KnowledgeTopic[]>;
  invalidate(chatbotId: string): void;
}

/** Minimum BM25 score for a chunk to count as relevant. */
export const MIN_RELEVANCE_SCORE = 0.1;
/**
 * Minimum IDF-weighted query coverage for a chunk to count as relevant. Stops a
 * single weak keyword ("capital" in "What is the capital of France?") from
 * pulling in an unrelated chunk.
 */
export const MIN_COVERAGE = 0.5;
/** Chunks scoring below this fraction of the best hit are not worth a context slot. */
export const RELATIVE_SCORE_FLOOR = 0.25;
export const MAX_PER_SOURCE = 2;
/** Token-set Jaccard above which two chunks count as near-duplicates (templated pages, footers). */
export const NEAR_DUPLICATE_JACCARD = 0.8;

export function isRelevant(h: RetrievedChunk): boolean {
  return h.score >= MIN_RELEVANCE_SCORE && h.coverage >= MIN_COVERAGE;
}

/**
 * Greedy diversification of an already ranked list: keeps at most `maxPerSource`
 * chunks per source and drops chunks that are near-duplicates of a kept one.
 */
export function diversify(ranked: RetrievedChunk[], k: number, maxPerSource = MAX_PER_SOURCE): RetrievedChunk[] {
  const out: RetrievedChunk[] = [];
  const sets: Set<string>[] = [];
  const perSource = new Map<string, number>();
  for (const h of ranked) {
    if (out.length >= k) break;
    const key = h.chunk.url ?? h.chunk.sourceId;
    if ((perSource.get(key) ?? 0) >= maxPerSource) continue;
    if (out.some((o) => o.chunk.id === h.chunk.id)) continue;
    const set = new Set(tokenize(h.chunk.text));
    if (sets.some((s) => jaccard(s, set) > NEAR_DUPLICATE_JACCARD)) continue;
    out.push(h);
    sets.push(set);
    perSource.set(key, (perSource.get(key) ?? 0) + 1);
  }
  return out;
}

const FAQ_BOOST = 1.25;

interface CacheEntry {
  version: number;
  index: BM25Index;
  chunks: Map<string, { chunk: KnowledgeChunk; type: SourceType }>;
  overviewIds: string[];
  sources: { type: SourceType; title: string; url?: string }[];
  topics: Map<string, KnowledgeTopic[]>;
}

export function pathDepth(url: string | undefined): number {
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
    return {
      version,
      index: new BM25Index(docs),
      chunks: map,
      overviewIds,
      sources: activeSources.map((s) => ({ type: s.type, title: s.title, url: s.url })),
      topics: new Map(),
    };
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
        return { chunk: c.chunk, sourceType: c.type, score: 0, matchedTerms: 0, coverage: 0 };
      }),
    };
  }

  async topics(chatbotId: string, businessName: string, opts: { knowledgeVersion?: number } = {}): Promise<KnowledgeTopic[]> {
    const e = await this.entry(chatbotId, await this.versionOf(chatbotId, opts.knowledgeVersion));
    let t = e.topics.get(businessName);
    if (!t) {
      t = knowledgeTopics(e.sources, businessName);
      if (e.topics.size > 5) e.topics.clear();
      e.topics.set(businessName, t);
    }
    return t;
  }

  async search(chatbotId: string, query: string, k: number, opts: { knowledgeVersion?: number } = {}): Promise<RetrievedChunk[]> {
    const e = await this.entry(chatbotId, await this.versionOf(chatbotId, opts.knowledgeVersion));
    const pool = e.index.search(expandSynonyms(query), Math.max(k * 5, 30));
    const floor = (pool[0]?.score ?? 0) * RELATIVE_SCORE_FLOOR;
    const ranked = pool
      .filter((h) => h.score >= floor)
      .map((h) => {
        const c = e.chunks.get(h.id)!;
        return { chunk: c.chunk, sourceType: c.type, score: h.score, matchedTerms: h.matchedTerms, coverage: h.coverage };
      });
    return diversify(ranked, k);
  }
}

/** Visitors and websites use different words for the same thing ("premium plan" vs "pricing"). */
const SYNONYM_GROUPS: [RegExp, string][] = [
  [/(cost|costs|price|prices|pricing|fees?|charges?|plans?|premium|paid|subscriptions?|packages?|how much|rates?|tariff)/i, 'pricing price cost plan fee'],
  [/(contact|reach|call|phone|email|support|helpline|whatsapp)/i, 'contact email phone support'],
  [/(refunds?|cancel(lation)?|money back|return)/i, 'refund cancellation policy'],
  [/(where|location|address|located|office|branch)/i, 'address location office'],
  [/(timings?|hours|open|opening|closing|schedule)/i, 'hours timings open'],
];

export function expandSynonyms(query: string): string {
  const extra = SYNONYM_GROUPS.filter(([re]) => re.test(query)).map(([, words]) => words);
  return extra.length ? `${query} ${extra.join(' ')}` : query;
}
