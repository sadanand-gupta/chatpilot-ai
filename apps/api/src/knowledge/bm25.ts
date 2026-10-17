/**
 * Okapi BM25 (k1 = 1.2, b = 0.75) over chunk text with a unicode-aware
 * tokenizer, English stopwords and light suffix stemming. Title/heading matches
 * and FAQ chunks get a boost.
 */

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by
  can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't
  have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't
  it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own
  same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's
  these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were
  weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're
  you've your yours yourself yourselves please tell know want like get also just us hi hello hey thanks thank`
    .split(/\s+/)
    .filter(Boolean),
);

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
  matchedTerms: number;
}

interface IndexedDoc {
  id: string;
  len: number;
  tf: Map<string, number>;
  titleTerms: Set<string>;
  boost: number;
}

export class BM25Index {
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

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
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, len: tokens.length, tf, titleTerms: new Set(tokenize(d.title ?? '')), boost: d.boost ?? 1 });
      total += tokens.length;
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  search(query: string, k = 5): BM25Hit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !this.docs.length) return [];
    const idfs = new Map(terms.map((t) => [t, this.idf(t)]));
    const hits: BM25Hit[] = [];
    for (const d of this.docs) {
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        const f = d.tf.get(t) ?? 0;
        const idf = idfs.get(t)!;
        const inTitle = d.titleTerms.has(t);
        if (!f && !inTitle) continue;
        matched++;
        if (f) score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / (this.avgLen || 1))));
        if (inTitle) score += idf * this.titleBoost;
      }
      if (score > 0) {
        // Reward chunks that cover more of the query's distinct terms.
        const coverage = 0.75 + 0.25 * (matched / terms.length);
        hits.push({ id: d.id, score: score * d.boost * coverage, matchedTerms: matched });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return hits.slice(0, k);
  }
}
