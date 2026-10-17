import { AIProviderError, estimateTokens, type AIChatRequest, type AIChatResult, type AIProvider } from './types';

/** Local Ollama server (POST /api/chat, stream:false). */
export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  private baseUrl: string;

  constructor(private opts: { baseUrl?: string; model: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  }

  async chat(req: AIChatRequest): Promise<AIChatResult> {
    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.opts.model,
          messages: req.messages,
          stream: false,
          options: { temperature: req.temperature, num_predict: req.maxTokens },
        }),
        signal: req.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError') throw new AIProviderError('AI request timed out', true);
      throw new AIProviderError(`AI network error: ${(e as Error).message}`, true);
    }
    if (!res.ok) {
      await res.text().catch(() => '');
      throw new AIProviderError(`Ollama returned HTTP ${res.status}`, res.status === 429 || res.status >= 500, res.status);
    }
    const json = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    const content = json.message?.content?.trim() ?? '';
    if (!content) throw new AIProviderError('Ollama returned an empty response', true);
    return {
      content,
      usage: {
        inputTokens: json.prompt_eval_count ?? estimateTokens(req.messages.map((m) => m.content).join('\n')),
        outputTokens: json.eval_count ?? estimateTokens(content),
      },
    };
  }

  async health(): Promise<boolean> {
    const f = this.opts.fetchImpl ?? fetch;
    try {
      const res = await f(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
