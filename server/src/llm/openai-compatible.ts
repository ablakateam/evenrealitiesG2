import OpenAI from 'openai';
import { env } from '../env.js';
import { LlmError, type LlmCompleteOptions, type LlmProvider, type LlmResult, type ProviderName } from './provider.js';

/**
 * Generic OpenAI-compatible Chat Completions provider.
 * Used for openai, openrouter, and ollama-cloud (all three share the same wire format).
 */
export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    public readonly name: ProviderName,
    private readonly client: OpenAI,
  ) {}

  async complete(opts: LlmCompleteOptions): Promise<LlmResult> {
    const t0 = Date.now();
    try {
      const resp = await this.client.chat.completions.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userMessage },
        ],
      });

      const text = resp.choices[0]?.message?.content ?? '';
      return {
        text,
        provider: this.name,
        model: opts.model,
        latency_ms: Date.now() - t0,
        tokens_in: resp.usage?.prompt_tokens,
        tokens_out: resp.usage?.completion_tokens,
      };
    } catch (err) {
      throw normalizeError(err, this.name, opts.model);
    }
  }
}

function normalizeError(err: unknown, provider: ProviderName, model: string): LlmError {
  if (err instanceof OpenAI.APIError) {
    return new LlmError(
      provider,
      model,
      err.status === 401 ? 'unauthorized' : err.status === 429 ? 'rate_limited' : 'api_error',
      err.message,
      err.status,
    );
  }
  if (err instanceof Error) {
    return new LlmError(provider, model, 'unknown', err.message);
  }
  return new LlmError(provider, model, 'unknown', String(err));
}

/** Factory for the OpenAI provider (api.openai.com). */
export function createOpenAI(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('openai', new OpenAI({ apiKey }));
}

/** Factory for OpenRouter (openrouter.ai, OpenAI-compatible). */
export function createOpenRouter(apiKey: string, baseURL: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(
    'openrouter',
    new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: {
        // OpenRouter recommends these headers for attribution + analytics.
        // Referer is the deployment's own public origin (config-driven).
        'HTTP-Referer': env.PUBLIC_BASE_URL ?? env.TWILIO_WEBHOOK_BASE_URL,
        'X-Title': 'VOX (Even Realities G2)',
      },
    }),
  );
}

/** Factory for Ollama Cloud / Turbo (ollama.com, OpenAI-compatible). */
export function createOllamaCloud(apiKey: string, baseURL: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(
    'ollama-cloud',
    new OpenAI({ apiKey, baseURL }),
  );
}
