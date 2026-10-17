import type { ChatbotConfig, SourceRef } from '@chatpilot/shared';
import type { Env } from '../config/env';
import type { AIClient } from '../ai';
import { parseFollowups } from '../ai/postprocess';
import { buildChatMessages, fallbackText } from '../ai/prompt';
import { injectionReply, offTopicReply, smallTalkReply, topicSuggestions, type CannedContext } from '../ai/replies';
import type { Logger } from '../lib/logger';
import { tokenize } from '../knowledge/bm25';
import { detectInjection, detectOffTopic, detectReplyLanguage, detectSmallTalk } from '../knowledge/intents';
import { isOverviewQuery } from '../knowledge/overview';
import { diversify, isRelevant, type RetrievedChunk, type Retriever } from '../knowledge/retriever';

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
  /** Up to 3 follow-up questions for the visitor to tap. */
  suggestions: string[];
  fallback: boolean;
  /** True when the AI call failed or timed out (content is then the fallback text). */
  aiFailed: boolean;
  aiCalled: boolean;
  retrieved: RetrievedChunk[];
  tokens: number;
}

/** Chunks sent to the model per answer. */
export const CONTEXT_CHUNKS = 6;

/** Retrieval-augmented answer flow shared by preview and public chat. */
export class ChatService {
  constructor(
    private readonly env: Env,
    private readonly retriever: Retriever,
    private readonly ai: AIClient,
    private readonly logger: Logger,
  ) {}

  private async canned(input: AnswerInput): Promise<CannedContext> {
    const topics = await this.retriever.topics(input.chatbotId, input.businessName, { knowledgeVersion: input.knowledgeVersion }).catch(() => []);
    return {
      lang: detectReplyLanguage(input.message, input.config.language),
      botName: input.config.botName,
      businessName: input.businessName,
      welcomeMessage: input.config.welcomeMessage,
      topics,
      suggestedQuestions: input.config.suggestedQuestions ?? [],
    };
  }

  async answer(input: AnswerInput): Promise<AnswerResult> {
    const started = Date.now();
    const base = { sources: [] as SourceRef[], suggestions: [] as string[], aiFailed: false, aiCalled: false, retrieved: [] as RetrievedChunk[], tokens: 0 };
    const log = { chatbotId: input.chatbotId, channel: input.channel };

    // 1. Prompt-injection attempts: fixed refusal, no AI call. Metadata-only log (never the message).
    const injection = detectInjection(input.message);
    if (injection) {
      this.logger.warn({ ...log, pattern: injection, length: input.message.length }, 'chat: prompt-injection attempt refused');
      const ctx = await this.canned(input);
      return { ...base, content: injectionReply(ctx), suggestions: topicSuggestions(ctx), fallback: false };
    }

    // 2. Small talk (greeting, who-are-you, thanks, bye, ok): quick canned reply, no AI call.
    const lastAssistant = [...input.history].reverse().find((h) => h.role === 'assistant')?.content;
    const intent = detectSmallTalk(input.message, { botName: input.config.botName, businessName: input.businessName, lastAssistantMessage: lastAssistant });
    if (intent) {
      const ctx = await this.canned(input);
      const suggestions = intent === 'farewell' ? [] : topicSuggestions(ctx);
      return { ...base, content: smallTalkReply(intent, ctx), suggestions, fallback: false };
    }

    // 3. Retrieval with a relevance gate (score + IDF-weighted query coverage).
    const opts = { knowledgeVersion: input.knowledgeVersion };
    const hits = await this.retriever.search(input.chatbotId, input.message, CONTEXT_CHUNKS, opts);
    let relevant = hits.filter(isRelevant);
    if (!relevant.length && input.message.split(/\s+/).length <= 6) {
      // Short follow-ups ("and the price?") borrow the previous visitor question for retrieval.
      const prevUser = [...input.history].reverse().find((h) => h.role === 'user')?.content;
      if (prevUser) relevant = (await this.retriever.search(input.chatbotId, `${prevUser.slice(0, 300)} ${input.message}`, CONTEXT_CHUNKS, opts)).filter(isRelevant);
    }
    const overviewQ = isOverviewQuery(input.message, tokenize(input.message));
    base.retrieved = hits;

    // 4. Clearly unrelated requests (coding, homework, trivia) with nothing relevant: polite redirect, no AI call.
    if (!relevant.length && !overviewQ) {
      const offTopic = detectOffTopic(input.message);
      if (offTopic) {
        this.logger.info({ ...log, kind: offTopic }, 'chat: off-topic redirect');
        const ctx = await this.canned(input);
        return { ...base, retrieved: [], content: offTopicReply(ctx), suggestions: topicSuggestions(ctx), fallback: false };
      }
    }

    // 5. Context: relevant chunks; overview questions also get home/FAQ context; with no
    //    relevant chunk the model gets the overview chunks plus an explicit "no match" note.
    let context = relevant;
    const noDirectMatch = !relevant.length && !overviewQ;
    if (!relevant.length || overviewQ) {
      const ov = await this.retriever.overview(input.chatbotId, opts);
      context = diversify([...relevant, ...ov.chunks], CONTEXT_CHUNKS);
    }
    if (!context.length) {
      // No active knowledge at all: answer with the fallback without calling the AI.
      this.logger.info({ ...log, hits: hits.length, ms: Date.now() - started }, 'chat: no knowledge, fallback');
      return { ...base, content: fallbackText(input.config), fallback: true };
    }
    base.retrieved = context;

    const messages = buildChatMessages({
      config: input.config,
      businessName: input.businessName,
      question: input.message,
      knowledge: context.map((h) => ({ title: h.chunk.title, url: h.chunk.url, heading: h.chunk.heading, text: h.chunk.text })),
      history: input.history,
      noDirectMatch,
    });

    try {
      const res = await this.ai.chat({ messages, maxTokens: this.env.MAX_OUTPUT_TOKENS, temperature: this.env.AI_TEMPERATURE });
      const sources: SourceRef[] = [];
      const seen = new Set<string>();
      for (const h of noDirectMatch ? [] : context) {
        if (!h.chunk.url) continue;
        if (seen.has(h.chunk.url)) continue;
        seen.add(h.chunk.url);
        sources.push({ url: h.chunk.url, title: h.chunk.title });
        if (sources.length >= 3) break;
      }
      const tokens = res.usage.inputTokens + res.usage.outputTokens;
      const parsed = parseFollowups(res.content);
      this.logger.info(
        {
          ...log,
          provider: this.ai.name,
          latencyMs: res.latencyMs,
          attempts: res.attempts,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          chunks: context.length,
          overview: context.length > relevant.length,
          noDirectMatch,
        },
        'chat: answered',
      );
      return { ...base, content: parsed.content.slice(0, 4000), suggestions: parsed.suggestions, sources, fallback: false, aiCalled: true, tokens };
    } catch (e) {
      this.logger.warn({ ...log, provider: this.ai.name, err: (e as Error).message, ms: Date.now() - started }, 'chat: AI unavailable');
      return { ...base, content: fallbackText(input.config), fallback: true, aiFailed: true, aiCalled: true };
    }
  }
}
