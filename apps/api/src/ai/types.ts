export type AIRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface AIChatRequest {
  messages: AIMessage[];
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface AIChatResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AIProvider {
  readonly name: string;
  chat(req: AIChatRequest): Promise<AIChatResult>;
  health(): Promise<boolean>;
}

/** Thrown by providers; `retryable` drives the retry policy (429 / 5xx / network). */
export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** Rough token estimate (about 4 chars per token) for providers that do not report usage. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);
