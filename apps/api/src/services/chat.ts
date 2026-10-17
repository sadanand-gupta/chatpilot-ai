import type { ChatbotConfig, SourceRef } from '@chatpilot/shared';
import type { Env } from '../config/env';
import type { AIClient } from '../ai';
import { buildChatMessages, fallbackText } from '../ai/prompt';
import type { Logger } from '../lib/logger';
import { tokenize } from '../knowledge/bm25';
import { isOverviewQuery } from '../knowledge/overview';
import { MIN_RELEVANCE_SCORE, type RetrievedChunk, type Retriever } from '../knowledge/retriever';

export interface AnswerInput {
  chatbotId: string;
  knowledgeVersion: number;
  config: ChatbotConfig;
  businessName: string;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  /** For logs only. */
  channel: string;
}

export interface AnswerResult {
  content: string;
  sources: SourceRef[];
  fallback: boolean;
  /** True when the AI call failed or timed out (content is then the fallback text). */
  aiFailed: boolean;
  aiCalled: boolean;
  retrieved: RetrievedChunk[];
  tokens: number;
}

const GREETING = /^(hi+|hello+|hey+|hiya|yo|hola|namaste|namaskar|hai|good\s+(morning|afternoon|evening|day))[\s!.,🙂👋]*$/iu;
const THANKS = /^(thanks?|thank\s+you|thx|ty|great|cool|ok(ay)?|perfect|awesome)[\s!.,🙂👍]*$/iu;
const BYE = /^(bye+|goodbye|see\s+you|cya)[\s!.,🙂👋]*$/iu;

/** Retrieval-augmented answer flow shared by preview and public chat. */
export class ChatService {
  constructor(
    private readonly env: Env,
    private readonly retriever: Retriever,
    private readonly ai: AIClient,
    private readonly logger: Logger,
  ) {}

  private smallTalk(message: string, config: ChatbotConfig): string | null {
    const m = message.trim();
    if (m.length > 40) return null;
    if (GREETING.test(m)) return config.welcomeMessage;
    if (THANKS.test(m)) return "You're welcome! Is there anything else I can help you with?";
    if (BYE.test(m)) return 'Thanks for chatting. Have a great day!';
    return null;
  }

  async answer(input: AnswerInput): Promise<AnswerResult> {
    const started = Date.now();
    const hits = await this.retriever.search(input.chatbotId, input.message, 5, { knowledgeVersion: input.knowledgeVersion });
    const relevant = hits.filter((h) => h.score >= MIN_RELEVANCE_SCORE);
    const base = { sources: [] as SourceRef[], aiFailed: false, aiCalled: false, retrieved: hits, tokens: 0 };

    if (!relevant.length) {
      const small = this.smallTalk(input.message, input.config);
      if (small) return { ...base, content: small, fallback: false };
    }
    // General questions ("what do you do?") and queries without a lexical match get
    // overview context (home page + FAQ/manual) so the AI can still answer or fall back.
    let context = relevant;
    if (!relevant.length || isOverviewQuery(input.message, tokenize(input.message))) {
      const ov = await this.retriever.overview(input.chatbotId, { knowledgeVersion: input.knowledgeVersion });
      const seenIds = new Set(relevant.map((r) => r.chunk.id));
      context = [...relevant, ...ov.chunks.filter((c) => !seenIds.has(c.chunk.id))].slice(0, 6);
    }
    if (!context.length) {
      // No active knowledge at all: answer with the fallback without calling the AI.
      this.logger.info({ chatbotId: input.chatbotId, channel: input.channel, hits: hits.length, ms: Date.now() - started }, 'chat: no knowledge, fallback');
      return { ...base, content: fallbackText(input.config), fallback: true };
    }
    base.retrieved = context;

    const messages = buildChatMessages({
      config: input.config,
      businessName: input.businessName,
      question: input.message,
      knowledge: context.map((h) => ({ title: h.chunk.title, url: h.chunk.url, heading: h.chunk.heading, text: h.chunk.text })),
      history: input.history,
    });

    try {
      const res = await this.ai.chat({ messages, maxTokens: this.env.MAX_OUTPUT_TOKENS, temperature: this.env.AI_TEMPERATURE });
      const sources: SourceRef[] = [];
      const seen = new Set<string>();
      for (const h of context) {
        if (!h.chunk.url) continue;
        if (seen.has(h.chunk.url)) continue;
        seen.add(h.chunk.url);
        sources.push({ url: h.chunk.url, title: h.chunk.title });
        if (sources.length >= 3) break;
      }
      const tokens = res.usage.inputTokens + res.usage.outputTokens;
      this.logger.info(
        {
          chatbotId: input.chatbotId,
          channel: input.channel,
          provider: this.ai.name,
          latencyMs: res.latencyMs,
          attempts: res.attempts,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          chunks: context.length,
          overview: context.length > relevant.length,
        },
        'chat: answered',
      );
      return { ...base, content: res.content.slice(0, 4000), sources, fallback: false, aiCalled: true, tokens };
    } catch (e) {
      this.logger.warn({ chatbotId: input.chatbotId, channel: input.channel, provider: this.ai.name, err: (e as Error).message, ms: Date.now() - started }, 'chat: AI unavailable');
      return { ...base, content: fallbackText(input.config), fallback: true, aiFailed: true, aiCalled: true };
    }
  }
}
