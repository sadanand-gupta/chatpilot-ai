import { AIProviderError, estimateTokens, type AIChatRequest, type AIChatResult, type AIProvider } from './types';

/**
 * OpenAI-compatible Chat Completions client. Works with OpenAI, Groq,
 * OpenRouter, Together, the Gemini OpenAI-compatible endpoint, vLLM, LM Studio.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai';
  private baseUrl: string;

  constructor(private opts: { baseUrl?: string; apiKey: string; model: string; fetchImpl?: typeof fetch }) {
    // Strip trailing slashes: Gemini's documented base URL ends with "/".
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  async chat(req: AIChatRequest): Promise<AIChatResult> {
    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          stream: false,
        }),
        signal: req.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') throw new AIProviderError('AI request timed out', true);
      throw new AIProviderError(`AI network error: ${(e as Error).message}`, true);
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await res.text().catch(() => '');
      throw new AIProviderError(
        `AI provider returned HTTP ${res.status}`,
        res.status === 429 || res.status >= 500,
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : undefined,
      );
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; reasoning?: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    // Reasoning models (e.g. openai/gpt-oss-*) may return an empty `content` with a
    // `reasoning` field when they run out of tokens. The reasoning is NEVER shown to users.
    const content = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      const reasoningOnly = !!json.choices?.[0]?.message?.reasoning;
      throw new AIProviderError(
        reasoningOnly
          ? 'AI model returned only reasoning and no answer (increase MAX_OUTPUT_TOKENS to 800+ for reasoning models)'
          : 'AI provider returned an empty response',
        false,
      );
    }
    const input = req.messages.map((m) => m.content).join('\n');
    return {
      content,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? estimateTokens(input),
        outputTokens: json.usage?.completion_tokens ?? estimateTokens(content),
      },
    };
  }

  async health(): Promise<boolean> {
    const f = this.opts.fetchImpl ?? fetch;
    try {
      const res = await f(`${this.baseUrl}/models`, {
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
