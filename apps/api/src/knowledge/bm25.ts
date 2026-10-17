/**
 * Okapi BM25 (k1 = 1.2, b = 0.75) over chunk text with a unicode-aware
 * tokenizer, English (+ a few romanised Hindi) stopwords and light suffix stemming.
 * Title/heading matches and FAQ chunks get a boost.
 *
 * Query side extras:
 * - Typo tolerance: query tokens missing from the index vocabulary are expanded to
 *   vocabulary tokens within Damerau-Levenshtein distance 1 (len 4–6) / 2 (len >= 7)
 *   or that start with the token (len >= 4). Expansions are capped and weighted lower.
 * - Coverage: every hit reports the IDF-weighted fraction of the query's terms it
 *   matched, so callers can tell "matched the one rare word that matters" from
 *   "matched one weak word of a mostly unrelated question".
 */

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by
  can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't
  have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't
  it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own
  same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's
  these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were
  weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're
  you've your yours yourself yourselves please tell know want like get also just us hi hello hey thanks thank much many anything something kindly`
    .split(/\s+/)
    .filter(Boolean),
);

/** Romanised Hindi (Hinglish) function words: they carry no topical meaning and would dilute matching. */
export const HINGLISH_STOPWORDS = new Set(
  'hai kya kaise kare karna karo karu karun ka ki ke mein me mujhe chahiye hain ho aur ya nahi nahin ji bhai plz pls kaun kab kahan kitna kitne kitni koi bhi hota hoti'.split(' '),
);
for (const w of HINGLISH_STOPWORDS) STOPWORDS.add(w);

const LATIN = /^[a-z0-9]+$/;

/** Light English stemmer: plurals, -ing, -ed, -ly. Non-latin tokens are left intact. */
export function stem(token: string): string {
  if (!LATIN.test(token) || token.length <= 3) return token;
  let t = token;
  if (t.endsWith('ies') && t.length > 4) t = t.slice(0, -3) + 'y';
  else if (/(sses|xes|zes|ches|shes)$/.test(t)) t = t.slice(0, -2);
  else if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) t = t.slice(0, -1);
  if (t.endsWith('ing') && t.length > 5) {
    t = t.slice(0, -3);
    if (/([b-df-hj-np-tv-z])\1$/.test(t)) t = t.slice(0, -1);
  } else if (t.endsWith('ed') && t.length > 4) {
    t = t.slice(0, -2);
    if (/([b-df-hj-np-tv-z])\1$/.test(t)) t = t.slice(0, -1);
  } else if (t.endsWith('ly') && t.length > 5) t = t.slice(0, -2);
  return t;
}

export function tokenize(text: string): string[] {
  const raw = text.normalize('NFKC').toLowerCase().replace(/['’]/g, "'").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}']*/gu) ?? [];
  const out: string[] = [];
  for (let t of raw) {
    t = t.replace(/'s$/, '').replace(/'/g, '');
    if (!t || STOPWORDS.has(t)) continue;
    if (t.length === 1 && LATIN.test(t)) continue;
    out.push(stem(t));
  }
  return out;
}

/**
 * Optimal-string-alignment Damerau-Levenshtein distance (adjacent transpositions
 * count as 1). Returns max + 1 as soon as the distance is known to exceed `max`.
 */
export function damerauLevenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m];
}

/** Token-set Jaccard similarity. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (big.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface BM25Doc {
  id: string;
  text: string;
  /** Title + heading: matches here add a boost. */
  title?: string;
  /** Multiplier applied to the final score (e.g. FAQ chunks). */
  boost?: number;
}

export interface BM25Hit {
  id: string;
  score: number;
  /** Number of distinct query terms (incl. typo expansions) matched. */
  matchedTerms: number;
  /** IDF-weighted fraction (0..1) of the query's meaningful terms this doc matched. */
  coverage: number;
}

/** A query term and the vocabulary tokens it may match (itself first). */
export interface QueryTerm {
  term: string;
  variants: { term: string; weight: number }[];
}

interface IndexedDoc {
  id: string;
  len: number;
  tf: Map<string, number>;
  titleTerms: Set<string>;
  boost: number;
}

/** Expansion weights relative to an exact match. */
export const PREFIX_WEIGHT = 0.8;
export const EDIT1_WEIGHT = 0.7;
export const EDIT2_WEIGHT = 0.5;
export const MAX_EXPANSIONS = 3;
const MAX_PREFIX_EXTRA = 5;

export class BM25Index {
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  /** Latin vocabulary bucketed by length, for typo expansion. */
  private byLength = new Map<number, string[]>();
  private expansionCache = new Map<string, QueryTerm['variants']>();

  constructor(
    docs: BM25Doc[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
    private readonly titleBoost = 0.6,
  ) {
    let total = 0;
    for (const d of docs) {
      const tokens = tokenize(d.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      const titleTerms = new Set(tokenize(d.title ?? ''));
      for (const t of new Set([...tf.keys(), ...titleTerms])) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, len: tokens.length, tf, titleTerms, boost: d.boost ?? 1 });
      total += tokens.length;
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 0;
    for (const t of this.df.keys()) {
      if (!LATIN.test(t) || /^\d+$/.test(t)) continue;
      const bucket = this.byLength.get(t.length) ?? [];
      bucket.push(t);
      this.byLength.set(t.length, bucket);
    }
  }

  get size(): number {
    return this.docs.length;
  }

  has(term: string): boolean {
    return this.df.has(term);
  }

  idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  /** Typo-tolerant variants of a query token that is not in the vocabulary (the token itself first). */
  expand(term: string): QueryTerm['variants'] {
    const self = [{ term, weight: 1 }];
    if (this.df.has(term) || !LATIN.test(term) || term.length < 4 || /^\d+$/.test(term)) return self;
    const cached = this.expansionCache.get(term);
    if (cached) return cached;
    const maxD = term.length >= 7 ? 2 : 1;
    const found: { term: string; weight: number; df: number }[] = [];
    for (let len = term.length - maxD; len <= term.length + MAX_PREFIX_EXTRA; len++) {
      for (const v of this.byLength.get(len) ?? []) {
        let w = 0;
        if (v.length > term.length && v.startsWith(term)) w = PREFIX_WEIGHT;
        if (w < EDIT1_WEIGHT && Math.abs(v.length - term.length) <= maxD) {
          const d = damerauLevenshtein(term, v, maxD);
          if (d === 1) w = Math.max(w, EDIT1_WEIGHT);
          else if (d === 2 && maxD >= 2) w = Math.max(w, EDIT2_WEIGHT);
        }
        if (w > 0) found.push({ term: v, weight: w, df: this.df.get(v) ?? 0 });
      }
    }
    found.sort((a, b) => b.weight - a.weight || b.df - a.df || a.term.localeCompare(b.term));
    const out = [...self, ...found.slice(0, MAX_EXPANSIONS).map(({ term: t, weight }) => ({ term: t, weight }))];
    if (this.expansionCache.size > 2000) this.expansionCache.clear();
    this.expansionCache.set(term, out);
    return out;
  }

  /** Distinct query terms with their typo-tolerant variants. */
  queryTerms(query: string): QueryTerm[] {
    return [...new Set(tokenize(query))].map((term) => ({ term, variants: this.expand(term) }));
  }

  search(query: string, k = 5): BM25Hit[] {
    const terms = this.queryTerms(query);
    if (!terms.length || !this.docs.length) return [];
    // A term's weight in the coverage measure: its own IDF when known; for typo'd terms
    // the IDF of the best known variant; unknown terms keep the maximum IDF.
    const groupIdf = terms.map((g) => {
      const known = g.variants.filter((v) => this.df.has(v.term));
      return known.length ? Math.max(...known.map((v) => this.idf(v.term))) : this.idf(g.term);
    });
    const totalIdf = groupIdf.reduce((a, b) => a + b, 0) || 1;
    const hits: BM25Hit[] = [];
    for (const d of this.docs) {
      let score = 0;
      let matched = 0;
      let covered = 0;
      terms.forEach((g, gi) => {
        let best = 0;
        let bestWeight = 0;
        for (const v of g.variants) {
          const f = d.tf.get(v.term) ?? 0;
          const inTitle = d.titleTerms.has(v.term);
          if (!f && !inTitle) continue;
          const idf = this.idf(v.term);
          let s = 0;
          if (f) s += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / (this.avgLen || 1))));
          if (inTitle) s += idf * this.titleBoost;
          s *= v.weight;
          if (s > best) {
            best = s;
            bestWeight = v.weight;
          }
        }
        if (best > 0) {
          matched++;
          score += best;
          covered += groupIdf[gi] * bestWeight;
        }
      });
      if (score > 0) {
        const coverage = Math.min(1, covered / totalIdf);
        // Reward chunks that cover more of the query's (IDF-weighted) terms.
        hits.push({ id: d.id, score: score * d.boost * (0.75 + 0.25 * coverage), matchedTerms: matched, coverage });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return hits.slice(0, k);
  }
}
