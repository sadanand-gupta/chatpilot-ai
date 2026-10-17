const OVERVIEW_RE =
  /\b(about|overview|summary|introduce|services?|offer(ing)?s?|products?|what\s+(do|does|can)\s+(you|they|this|the|your)|what\s+(do|does)\s+[\w.-]+\s+(do|offer|provide|sell)|what\s+is\s+[\w.-]+\s*\??$|who\s+(are|is)\s+(you|this|the)|tell\s+me\s+(about|more)|what\s+(is|'s)\s+(this|your|the)\s+(website|site|business|company|place|shop|clinic|store)|what\s+is\s+this|how\s+can\s+you\s+help)\b/i;

/** Heuristic for general/overview questions (short or stopword-only queries in any language count too). */
export function isOverviewQuery(query: string, tokens: string[]): boolean {
  const q = query.trim();
  if (!tokens.length) return true; // only stopwords / punctuation
  if (q.split(/\s+/).length <= 2 && tokens.length <= 1 && q.length <= 20) return true;
  return OVERVIEW_RE.test(q);
}
