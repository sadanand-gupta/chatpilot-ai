/**
 * Server-side post-processing of model output: the trailing FOLLOWUPS line is
 * parsed into suggestion chips and removed from the visible reply.
 */

const FOLLOWUPS_LINE = /^\s*[*_]*\s*follow[- ]?ups?\s*[*_]*\s*[:：]\s*(.*)$/i;

function sanitizeSuggestion(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#<>[\]{}]/g, '')
    .replace(/^\s*(?:[-•]|\d+[.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a model reply into visible content and up to 3 follow-up suggestions. Only the final non-empty line counts. */
export function parseFollowups(raw: string, max = 3): { content: string; suggestions: string[] } {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  const suggestions: string[] = [];
  if (last >= 0) {
    const m = FOLLOWUPS_LINE.exec(lines[last]);
    if (m) {
      lines.splice(last, 1);
      for (const part of m[1].split('|')) {
        const s = sanitizeSuggestion(part);
        if (!s || s.length > 100) continue;
        if (suggestions.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
        suggestions.push(s);
        if (suggestions.length >= max) break;
      }
    }
  }
  // Stray FOLLOWUPS lines elsewhere are never shown (and never parsed).
  const content = lines
    .filter((l) => !FOLLOWUPS_LINE.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { content, suggestions };
}
