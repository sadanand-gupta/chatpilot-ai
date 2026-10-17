import { AIProviderError, estimateTokens, type AIChatRequest, type AIChatResult, type AIProvider } from './types';

export const MOCK_PREFIX = '[dev mock AI]';

/**
 * DEV/TEST ONLY. Deterministic provider that composes a reply from the top
 * knowledge excerpt so the whole pipeline runs without an AI key.
 * Every reply is prefixed with "[dev mock AI]" so nobody mistakes it for a real model.
 * The API refuses AI_PROVIDER=mock in production.
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
    let excerpt = '';
    if (knowledgeMsg) {
      const m = /\[1\][^\n]*\n([\s\S]*?)(?:\n\[2\]|\n<\/knowledge>)/.exec(knowledgeMsg.content);
      excerpt = (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
    }
    const words = excerpt.split(' ').filter(Boolean);
    const content = words.length
      ? `${MOCK_PREFIX} Based on the website: ${words.slice(0, 60).join(' ')}${words.length > 60 ? '…' : ''}`
      : `${MOCK_PREFIX} I could not find that in the knowledge base.`;
    return {
      content,
      usage: { inputTokens: estimateTokens(req.messages.map((m) => m.content).join('\n')), outputTokens: estimateTokens(content) },
    };
  }

  async health(): Promise<boolean> {
    return true;
  }
}
