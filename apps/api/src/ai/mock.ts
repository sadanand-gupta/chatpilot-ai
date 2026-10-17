import { NO_MATCH_NOTE } from './prompt';
import { AIProviderError, estimateTokens, type AIChatRequest, type AIChatResult, type AIProvider } from './types';

/** Footer on every mock reply so nobody mistakes it for a real model. */
export const MOCK_MARKER = 'Dev preview answer';
const MOCK_FOOTER = `_${MOCK_MARKER} — connect an AI provider (AI_PROVIDER) for natural, conversational replies._`;

const STOPWORDS = new Set(
  'a an and are as at be by can do does for from have how i in is it me my of on or our please tell that the their there this to us we what when where which who why will with you your about any could would should'.split(
    ' ',
  ),
);

interface KnowledgeEntry {
  title?: string;
  url?: string;
  body: string;
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

/** "FOLLOWUPS: …" line built from the retrieved entry titles (lets the suggestion pipeline be tested without a model). */
function followups(entries: KnowledgeEntry[]): string {
  const titles = [...new Set(entries.map((e) => e.title).filter((t): t is string => !!t && t.length <= 50))].slice(0, 3);
  return titles.length ? `FOLLOWUPS: ${titles.map((t) => `Tell me about ${t}`).join(' | ')}` : '';
}

/** Parses the numbered entries of the <knowledge> block built by prompt.ts. */
function parseKnowledge(content: string): KnowledgeEntry[] {
  const inner = /<knowledge>([\s\S]*?)<\/knowledge>/.exec(content)?.[1] ?? '';
  const entries: KnowledgeEntry[] = [];
  for (const part of inner.split(/\n(?=\[\d+\] )/).slice(1)) {
    const [header, ...rest] = part.split('\n');
    const label = header.replace(/^\[\d+\]\s*/, '');
    const urlMatch = / - (https?:\/\/\S+)$/.exec(label);
    entries.push({
      title: (urlMatch ? label.slice(0, urlMatch.index) : label).split(/\s+[|—–-]\s+/)[0]?.trim() || undefined,
      url: urlMatch?.[1],
      body: rest.join(' ').replace(/\s+/g, ' ').trim(),
    });
  }
  return entries;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.replace(/^[^:]{1,60}:\s+(?=[A-Z])/, '').trim()) // drop "Heading: " prefixes
    .filter((s) => s.length >= 15 && s.length <= 260 && /[a-z]/.test(s));
}

/**
 * DEV/TEST ONLY. Deterministic, extractive provider: picks the sentences from the
 * retrieved knowledge that best match the question and formats them like a real
 * assistant reply (lead sentence, bullets, source link), so the whole pipeline and UI
 * can be exercised without an AI key. It cannot paraphrase or reason — every reply
 * carries a "Dev preview answer" footer. The API refuses AI_PROVIDER=mock in production.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';
  /** Test hook: make the next N calls fail (non-retryable). */
  failNext = 0;
  calls = 0;
  lastRequest: AIChatRequest | null = null;

  async chat(req: AIChatRequest): Promise<AIChatResult> {
    this.calls++;
    this.lastRequest = req;
    if (this.failNext > 0) {
      this.failNext--;
      throw new AIProviderError('mock AI failure', false, 500);
    }
    const knowledgeMsg = req.messages.find((m) => m.role === 'user' && m.content.includes('<knowledge>'));
    const questionMsg = [...req.messages].reverse().find((m) => m.role === 'user' && m.content.includes('<visitor_message>'));
    const question = /<visitor_message>\s*([\s\S]*?)\s*<\/visitor_message>/.exec(questionMsg?.content ?? '')?.[1] ?? '';
    const entries = knowledgeMsg ? parseKnowledge(knowledgeMsg.content) : [];
    let content: string;
    if (knowledgeMsg?.content.includes(NO_MATCH_NOTE)) {
      // Emulates the policy: nothing matched, so answer with the configured fallback.
      const sys = req.messages.find((m) => m.role === 'system')?.content ?? '';
      const fallback = /reply with exactly this message[^"]*"([\s\S]*?)"(?: and then share|\n)/.exec(sys)?.[1];
      content = `${fallback ?? "I couldn't find that in our information yet."}\n\n${MOCK_FOOTER}`;
    } else content = this.compose(question, entries);
    content += `
${followups(entries)}`;
    return {
      content,
      usage: { inputTokens: estimateTokens(req.messages.map((m) => m.content).join('\n')), outputTokens: estimateTokens(content) },
    };
  }

  private compose(question: string, entries: KnowledgeEntry[]): string {
    const q = new Set(tokens(question));
    const scored: { text: string; score: number; entry: number; order: number }[] = [];
    entries.forEach((e, entry) =>
      sentences(e.body).forEach((text, i) => {
        const overlap = tokens(text).filter((t) => q.has(t)).length;
        // Earlier entries are better-ranked by retrieval; earlier sentences tend to be summaries.
        scored.push({ text, score: overlap * 3 + (entries.length - entry) * 0.5 - i * 0.05, entry, order: scored.length });
      }),
    );
    if (!scored.length) return `I couldn't find that in our information yet. Please contact the team and they'll be happy to help.\n\n${MOCK_FOOTER}`;

    const seen = new Set<string>();
    const picked = scored
      .sort((a, b) => b.score - a.score)
      .filter((s) => {
        const key = s.text.slice(0, 50).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);

    const [lead, ...rest] = picked;
    const lines = [lead.text];
    if (rest.length) lines.push('', ...rest.map((s) => `- ${s.text}`));
    const src = entries[lead.entry];
    if (src?.url) lines.push('', `Learn more: [${src.title ?? 'this page'}](${src.url})`);
    lines.push('', MOCK_FOOTER);
    return lines.join('\n');
  }

  async health(): Promise<boolean> {
    return true;
  }
}
