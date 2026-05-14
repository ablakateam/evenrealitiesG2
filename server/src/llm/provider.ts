/**
 * Pluggable LLM provider interface.
 *
 * Used for intent parsing, tone rewrites, subject suggestion, reply-aware
 * tone matching, and Smart Idle suggestion phrasing. STT stays on OpenAI
 * Whisper (own service) and is not routed through this interface.
 *
 * Four implementations:
 *   - AnthropicProvider           (native SDK, prompt caching support)
 *   - OpenAICompatibleProvider    (shared by OpenAI / OpenRouter / Ollama Cloud)
 *
 * User picks provider + model via Preferences; factory() reads the choice
 * and resolves to an instance.
 */
export type ProviderName = 'anthropic' | 'openai' | 'openrouter' | 'ollama-cloud';

export interface LlmCompleteOptions {
  /** System prompt (instructions). For Anthropic with cacheSystemPrompt=true, this is cached ephemeral. */
  systemPrompt: string;
  /** User message body. */
  userMessage: string;
  /** Provider-specific model identifier (e.g. "claude-haiku-4-5", "gpt-4o-mini"). */
  model: string;
  /** Default 1024. */
  maxTokens?: number;
  /** Default 0.7. */
  temperature?: number;
  /** Anthropic-only: mark systemPrompt as cacheable (saves cost on repeated calls). */
  cacheSystemPrompt?: boolean;
}

export interface LlmResult {
  text: string;
  provider: ProviderName;
  model: string;
  latency_ms: number;
  tokens_in?: number;
  tokens_out?: number;
  /** Anthropic-only: tokens served from prompt cache (subset of tokens_in). */
  cache_read_tokens?: number;
  cache_create_tokens?: number;
}

export interface LlmProvider {
  readonly name: ProviderName;
  complete(opts: LlmCompleteOptions): Promise<LlmResult>;
}

/**
 * Structured error from a provider. Lets us pass clean info up to the API layer.
 */
export class LlmError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly model: string,
    public readonly code: string,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(`[${provider}/${model}] ${code}: ${message}`);
    this.name = 'LlmError';
  }
}
