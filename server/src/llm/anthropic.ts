import Anthropic from '@anthropic-ai/sdk';
import { LlmError, type LlmCompleteOptions, type LlmProvider, type LlmResult } from './provider.js';

/**
 * Anthropic provider — uses native @anthropic-ai/sdk for prompt caching support.
 * When `cacheSystemPrompt: true`, the system prompt is sent as a content block
 * with `cache_control: { type: "ephemeral" }`. Subsequent calls within 5 minutes
 * hit the cache, dramatically reducing per-call latency + token cost — critical
 * for the parallel-rewrite pipeline where the same 7 tone prompts fire repeatedly.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(opts: LlmCompleteOptions): Promise<LlmResult> {
    const t0 = Date.now();

    const system: Anthropic.TextBlockParam[] | string = opts.cacheSystemPrompt
      ? [{ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } }]
      : opts.systemPrompt;

    try {
      const resp = await this.client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        system,
        messages: [{ role: 'user', content: opts.userMessage }],
      });

      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const usage = resp.usage;
      return {
        text,
        provider: 'anthropic',
        model: opts.model,
        latency_ms: Date.now() - t0,
        tokens_in: usage.input_tokens,
        tokens_out: usage.output_tokens,
        cache_read_tokens: usage.cache_read_input_tokens ?? undefined,
        cache_create_tokens: usage.cache_creation_input_tokens ?? undefined,
      };
    } catch (err) {
      throw normalizeError(err, opts.model);
    }
  }
}

function normalizeError(err: unknown, model: string): LlmError {
  if (err instanceof Anthropic.APIError) {
    return new LlmError(
      'anthropic',
      model,
      err.status === 401 ? 'unauthorized' : err.status === 429 ? 'rate_limited' : 'api_error',
      err.message,
      err.status,
    );
  }
  if (err instanceof Error) {
    return new LlmError('anthropic', model, 'unknown', err.message);
  }
  return new LlmError('anthropic', model, 'unknown', String(err));
}
